package metadata

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"time"

	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
	"github.com/lumavault/lumavault/core/internal/validate"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// dedupKey identifies an object by (namespace, sha256_digest) for idempotent CommitObject deduplication.
type dedupKey struct {
	namespace lumavaultv1.Namespace
	sha256    string
}

// pageCursor encodes the deterministic pagination position for ListObjects.
type pageCursor struct {
	CreatedAtNanos int64  `json:"t"`
	ID             string `json:"id"`
}

// Engine is a pure deterministic in-memory metadata state machine for LumaVault Core.
// All mutating transitions accept explicit objectID and timestamp arguments and perform
// zero disk or network I/O, allowing LocalMetadataStore (Day 1) and PaxosMetadataStore (Project 6)
// to share identical validation, deduplication, indexing, and chunk refcounting.
//
// Callers must synchronize access to Engine externally (e.g., via sync.RWMutex or a single-threaded
// consensus apply loop).
type Engine struct {
	objects    map[string]*lumavaultv1.ObjectMetadata
	dedupIndex map[dedupKey][]string // object IDs ordered oldest-first (CreatedAt ASC, Id ASC)
	chunkRefs  map[string]int
}

// NewEngine returns an initialized, empty deterministic metadata Engine.
func NewEngine() *Engine {
	return &Engine{
		objects:    make(map[string]*lumavaultv1.ObjectMetadata),
		dedupIndex: make(map[dedupKey][]string),
		chunkRefs:  make(map[string]int),
	}
}

// Restore populates the Engine from persisted objects.
// All inputs are validated before replacing the Engine's state; if an error is returned,
// the existing Engine state remains untouched.
func (e *Engine) Restore(objects []*lumavaultv1.ObjectMetadata) error {
	sorted := make([]*lumavaultv1.ObjectMetadata, len(objects))
	seenIDs := make(map[string]struct{}, len(objects))
	for i, obj := range objects {
		if obj == nil {
			return fmt.Errorf("%w: cannot restore nil object", validate.ErrInvalid)
		}
		if err := validate.ObjectID(obj.Id); err != nil {
			return fmt.Errorf("cannot restore object: %w", err)
		}
		if _, dup := seenIDs[obj.Id]; dup {
			return fmt.Errorf("%w: duplicate object ID %q in Restore", validate.ErrInvalid, obj.Id)
		}
		seenIDs[obj.Id] = struct{}{}
		sorted[i] = cloneObject(obj)
	}

	// Sort oldest-first (CreatedAt ASC, Id ASC) so deduplication slice order is deterministic.
	sort.Slice(sorted, func(i, j int) bool {
		return compareObjectsAsc(sorted[i], sorted[j]) < 0
	})

	newObjects := make(map[string]*lumavaultv1.ObjectMetadata, len(sorted))
	newDedup := make(map[dedupKey][]string, len(sorted))
	newChunkRefs := make(map[string]int)

	for _, obj := range sorted {
		newObjects[obj.Id] = obj
		key := dedupKey{namespace: obj.Namespace, sha256: obj.Sha256Digest}
		newDedup[key] = append(newDedup[key], obj.Id)
		adjustChunkRefsMap(newChunkRefs, obj, +1)
	}

	e.objects = newObjects
	e.dedupIndex = newDedup
	e.chunkRefs = newChunkRefs
	return nil
}

// CommitObject validates req and either returns an existing deduplicated object (when !req.SkipDedup)
// or commits a new ObjectMetadata record with the supplied objectID and timestamp.
func (e *Engine) CommitObject(req *lumavaultv1.CommitObjectRequest, objectID string, now time.Time) (*lumavaultv1.ObjectMetadata, bool, error) {
	if err := validate.CommitRequest(req); err != nil {
		return nil, false, err
	}
	if err := validate.ObjectID(objectID); err != nil {
		return nil, false, err
	}

	key := dedupKey{namespace: req.Namespace, sha256: req.Sha256Digest}
	if !req.SkipDedup {
		if ids := e.dedupIndex[key]; len(ids) > 0 {
			return cloneObject(e.objects[ids[0]]), true, nil
		}
	}

	if _, exists := e.objects[objectID]; exists {
		return nil, false, fmt.Errorf("%w: object ID %q already exists", validate.ErrInvalid, objectID)
	}

	ts := timestamppb.New(now.UTC())
	obj := &lumavaultv1.ObjectMetadata{
		Id:                 objectID,
		Namespace:          req.Namespace,
		Filename:           req.Filename,
		MimeType:           req.MimeType,
		SizeBytes:          req.SizeBytes,
		ChunkSizeBytes:     req.ChunkSizeBytes,
		Sha256Digest:       req.Sha256Digest,
		ChunkHashes:        slices.Clone(req.ChunkHashes),
		ThumbnailChunkHash: req.ThumbnailChunkHash,
		CreatedAt:          ts,
		UpdatedAt:          cloneTimestamp(ts),
	}

	e.objects[objectID] = obj
	e.insertDedupID(key, obj)
	adjustChunkRefsMap(e.chunkRefs, obj, +1)

	return cloneObject(obj), false, nil
}

// GetObject retrieves a deep-cloned ObjectMetadata by ID, or returns ErrObjectNotFound.
func (e *Engine) GetObject(objectID string) (*lumavaultv1.ObjectMetadata, error) {
	if err := validate.ObjectID(objectID); err != nil {
		return nil, err
	}
	obj, ok := e.objects[objectID]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrObjectNotFound, objectID)
	}
	return cloneObject(obj), nil
}

// ListObjects filters, sorts (created_at DESC, id ASC), and paginates objects within a required namespace.
func (e *Engine) ListObjects(req *lumavaultv1.ListObjectsRequest) (*lumavaultv1.ListObjectsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("%w: request is nil", validate.ErrInvalid)
	}
	if err := validate.Namespace(req.Namespace); err != nil {
		return nil, err
	}
	if req.PageSize < 0 {
		return nil, fmt.Errorf("%w: page_size (%d) must not be negative", validate.ErrInvalid, req.PageSize)
	}

	pageSize := int(req.PageSize)
	if pageSize == 0 {
		pageSize = DefaultPageSize
	} else if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}

	var cursor *pageCursor
	if req.PageToken != "" {
		c, err := decodePageToken(req.PageToken)
		if err != nil {
			return nil, err
		}
		cursor = c
	}

	var matched []*lumavaultv1.ObjectMetadata
	for _, obj := range e.objects {
		if obj.Namespace != req.Namespace {
			continue
		}
		matched = append(matched, obj)
	}

	sort.Slice(matched, func(i, j int) bool {
		return compareObjectsDesc(matched[i], matched[j]) < 0
	})

	startIdx := 0
	if cursor != nil {
		startIdx = sort.Search(len(matched), func(i int) bool {
			return isAfterCursor(matched[i], cursor)
		})
	}

	if startIdx >= len(matched) {
		return &lumavaultv1.ListObjectsResponse{}, nil
	}

	endIdx := startIdx + pageSize
	var nextToken string
	if endIdx < len(matched) {
		last := matched[endIdx-1]
		nextToken = encodePageToken(last)
	} else {
		endIdx = len(matched)
	}

	page := make([]*lumavaultv1.ObjectMetadata, 0, endIdx-startIdx)
	for _, obj := range matched[startIdx:endIdx] {
		page = append(page, cloneObject(obj))
	}

	return &lumavaultv1.ListObjectsResponse{
		Objects:       page,
		NextPageToken: nextToken,
	}, nil
}

// UpdateObjectMetadata applies a partial update to mutable storage-level metadata fields
// (filename, mime_type, thumbnail_chunk_hash) using req.UpdateMask.
func (e *Engine) UpdateObjectMetadata(req *lumavaultv1.UpdateObjectMetadataRequest, now time.Time) (*lumavaultv1.ObjectMetadata, error) {
	if req == nil || req.Object == nil {
		return nil, fmt.Errorf("%w: object is required", validate.ErrInvalid)
	}
	if err := validate.ObjectID(req.Object.Id); err != nil {
		return nil, err
	}
	if req.UpdateMask == nil || len(req.UpdateMask.Paths) == 0 {
		return nil, fmt.Errorf("%w: non-empty update_mask is required", validate.ErrInvalid)
	}

	existing, ok := e.objects[req.Object.Id]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrObjectNotFound, req.Object.Id)
	}

	updated := cloneObject(existing)
	src := req.Object

	for _, path := range req.UpdateMask.Paths {
		if err := applyFieldMaskPath(updated, src, path); err != nil {
			return nil, err
		}
	}

	updated.UpdatedAt = timestamppb.New(now.UTC())

	// Update chunk reference counts if thumbnail_chunk_hash changed.
	if existing.ThumbnailChunkHash != updated.ThumbnailChunkHash {
		adjustChunkRefsMap(e.chunkRefs, existing, -1)
		adjustChunkRefsMap(e.chunkRefs, updated, +1)
	}

	e.objects[updated.Id] = updated
	return cloneObject(updated), nil
}

// DeleteObject removes objectID from the Engine and updates deduplication and chunk reference indexes.
func (e *Engine) DeleteObject(objectID string) error {
	if err := validate.ObjectID(objectID); err != nil {
		return err
	}
	existing, ok := e.objects[objectID]
	if !ok {
		return fmt.Errorf("%w: %q", ErrObjectNotFound, objectID)
	}

	delete(e.objects, objectID)

	// Remove objectID from the oldest-first slice; if others remain, ids[0] is the oldest remaining object.
	key := dedupKey{namespace: existing.Namespace, sha256: existing.Sha256Digest}
	if ids := slices.DeleteFunc(e.dedupIndex[key], func(id string) bool { return id == objectID }); len(ids) > 0 {
		e.dedupIndex[key] = ids
	} else {
		delete(e.dedupIndex, key)
	}

	adjustChunkRefsMap(e.chunkRefs, existing, -1)
	return nil
}

// IsChunkReferenced reports whether hash is a valid SHA-256 digest currently referenced by at least one object.
func (e *Engine) IsChunkReferenced(hash string) (bool, error) {
	if err := validate.Hash(hash); err != nil {
		return false, err
	}
	return e.chunkRefs[hash] > 0, nil
}

// hasObject reports whether an object with objectID exists in the engine without cloning it.
func (e *Engine) hasObject(objectID string) bool {
	_, ok := e.objects[objectID]
	return ok
}

// putObjectDirect restores a previously committed object record in place and reconciles its
// chunk reference counts when rolling back a failed disk write during UpdateObjectMetadata.
func (e *Engine) putObjectDirect(obj *lumavaultv1.ObjectMetadata) {
	if obj == nil || validate.ObjectID(obj.Id) != nil {
		return
	}
	cloned := cloneObject(obj)
	if prev, ok := e.objects[cloned.Id]; ok {
		adjustChunkRefsMap(e.chunkRefs, prev, -1)
	}
	e.objects[cloned.Id] = cloned
	adjustChunkRefsMap(e.chunkRefs, cloned, +1)
}

// insertDedupID inserts obj.Id into dedupIndex[key] in oldest-first (CreatedAt ASC, Id ASC) order.
func (e *Engine) insertDedupID(key dedupKey, obj *lumavaultv1.ObjectMetadata) {
	ids := e.dedupIndex[key]
	idx, _ := slices.BinarySearchFunc(ids, obj, func(existingID string, target *lumavaultv1.ObjectMetadata) int {
		return compareObjectsAsc(e.objects[existingID], target)
	})
	e.dedupIndex[key] = slices.Insert(ids, idx, obj.Id)
}

// adjustChunkRefsMap increments or decrements per-object unique chunk reference counts in refs
// across chunk_hashes and thumbnail_chunk_hash, removing entries whose count drops to zero.
func adjustChunkRefsMap(refs map[string]int, obj *lumavaultv1.ObjectMetadata, delta int) {
	seen := make(map[string]struct{}, len(obj.ChunkHashes)+1)
	for _, h := range obj.ChunkHashes {
		if h == "" {
			continue
		}
		seen[h] = struct{}{}
	}
	if obj.ThumbnailChunkHash != "" {
		seen[obj.ThumbnailChunkHash] = struct{}{}
	}
	for h := range seen {
		next := refs[h] + delta
		if next <= 0 {
			delete(refs, h)
		} else {
			refs[h] = next
		}
	}
}

// applyFieldMaskPath copies a single mutable FieldMask field from src onto updated.
func applyFieldMaskPath(updated, src *lumavaultv1.ObjectMetadata, path string) error {
	switch path {
	case "filename":
		updated.Filename = src.Filename
	case "mime_type":
		updated.MimeType = src.MimeType
	case "thumbnail_chunk_hash":
		if src.ThumbnailChunkHash != "" {
			if err := validate.Hash(src.ThumbnailChunkHash); err != nil {
				return fmt.Errorf("thumbnail_chunk_hash: %w", err)
			}
		}
		updated.ThumbnailChunkHash = src.ThumbnailChunkHash
	default:
		return fmt.Errorf("%w: unsupported or immutable update_mask path %q", validate.ErrInvalid, path)
	}
	return nil
}

// compareObjectsAsc orders objects oldest-first by (CreatedAt ASC, Id ASC).
func compareObjectsAsc(a, b *lumavaultv1.ObjectMetadata) int {
	ta := a.GetCreatedAt().AsTime().UnixNano()
	tb := b.GetCreatedAt().AsTime().UnixNano()
	if ta != tb {
		if ta < tb {
			return -1
		}
		return 1
	}
	if a.Id < b.Id {
		return -1
	}
	if a.Id > b.Id {
		return 1
	}
	return 0
}

// compareObjectsDesc orders objects newest-first by (CreatedAt DESC, Id ASC) for ListObjects.
func compareObjectsDesc(a, b *lumavaultv1.ObjectMetadata) int {
	ta := a.GetCreatedAt().AsTime().UnixNano()
	tb := b.GetCreatedAt().AsTime().UnixNano()
	if ta != tb {
		if ta > tb {
			return -1
		}
		return 1
	}
	if a.Id < b.Id {
		return -1
	}
	if a.Id > b.Id {
		return 1
	}
	return 0
}

// isAfterCursor reports whether obj falls strictly after cursor c under (CreatedAt DESC, Id ASC) ordering.
func isAfterCursor(obj *lumavaultv1.ObjectMetadata, c *pageCursor) bool {
	t := obj.GetCreatedAt().AsTime().UnixNano()
	if t != c.CreatedAtNanos {
		return t < c.CreatedAtNanos
	}
	return obj.Id > c.ID
}

// encodePageToken encodes obj's (CreatedAt, Id) sort key as a URL-safe base64 pagination token.
func encodePageToken(obj *lumavaultv1.ObjectMetadata) string {
	c := pageCursor{
		CreatedAtNanos: obj.GetCreatedAt().AsTime().UnixNano(),
		ID:             obj.Id,
	}
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

// decodePageToken parses and validates a URL-safe base64 pagination token.
func decodePageToken(token string) (*pageCursor, error) {
	b, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid page_token encoding: %v", validate.ErrInvalid, err)
	}
	var c pageCursor
	if err := json.Unmarshal(b, &c); err != nil || c.ID == "" {
		return nil, fmt.Errorf("%w: malformed page_token payload", validate.ErrInvalid)
	}
	return &c, nil
}

// cloneObject returns a deep Protobuf copy of obj so callers cannot mutate engine state.
func cloneObject(obj *lumavaultv1.ObjectMetadata) *lumavaultv1.ObjectMetadata {
	if obj == nil {
		return nil
	}
	return proto.Clone(obj).(*lumavaultv1.ObjectMetadata)
}

// cloneTimestamp returns a deep Protobuf copy of ts.
func cloneTimestamp(ts *timestamppb.Timestamp) *timestamppb.Timestamp {
	if ts == nil {
		return nil
	}
	return proto.Clone(ts).(*timestamppb.Timestamp)
}

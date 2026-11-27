package metadata

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
	"github.com/lumavault/lumavault/core/internal/validate"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	objectsSubdir = "objects"
	tmpSubdir     = "tmp"
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

// Compile-time check that LocalMetadataStore implements MetadataStore.
var _ MetadataStore = (*LocalMetadataStore)(nil)

// LocalMetadataStore is the Day-1 filesystem-backed MetadataStore implementation.
// It maintains object manifests, deduplication indexes, and chunk reference counts
// in memory protected by a sync.RWMutex, and persists one atomic binary Protobuf file
// per object under <rootDir>/objects/<id>.pb.
type LocalMetadataStore struct {
	objectsDir string
	tmpDir     string

	mu         sync.RWMutex
	objects    map[string]*lumavaultv1.ObjectMetadata
	dedupIndex map[dedupKey][]string // object IDs ordered oldest-first (CreatedAt ASC, Id ASC)
	chunkRefs  map[string]int
}

// NewLocalMetadataStore initializes a LocalMetadataStore rooted at rootDir, creating
// the objects/ and tmp/ subdirectories, cleaning up any orphaned staging files in tmp/,
// and rebuilding all in-memory indexes and chunk reference counts from on-disk state.
func NewLocalMetadataStore(rootDir string) (*LocalMetadataStore, error) {
	if rootDir == "" {
		return nil, errors.New("metadata: rootDir must not be empty")
	}
	cleanRoot := filepath.Clean(rootDir)
	objectsDir := filepath.Join(cleanRoot, objectsSubdir)
	tmpDir := filepath.Join(cleanRoot, tmpSubdir)

	// Create the objects directory if missing (mkdir -p with 0755 / rwxr-xr-x).
	if err := os.MkdirAll(objectsDir, 0o755); err != nil {
		return nil, fmt.Errorf("metadata: create objects dir: %w", err)
	}
	// Remove any orphaned meta-* staging files left behind by an interrupted write.
	if err := os.RemoveAll(tmpDir); err != nil {
		return nil, fmt.Errorf("metadata: clean tmp dir: %w", err)
	}
	// Create a clean staging directory (mkdir -p with 0755 / rwxr-xr-x).
	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		return nil, fmt.Errorf("metadata: create tmp dir: %w", err)
	}

	s := &LocalMetadataStore{
		objectsDir: objectsDir,
		tmpDir:     tmpDir,
		objects:    make(map[string]*lumavaultv1.ObjectMetadata),
		dedupIndex: make(map[dedupKey][]string),
		chunkRefs:  make(map[string]int),
	}

	if err := s.loadFromDisk(); err != nil {
		return nil, err
	}
	return s, nil
}

// CommitObject validates and commits an object manifest, persisting the resulting
// ObjectMetadata to <rootDir>/objects/<id>.pb atomically.
func (s *LocalMetadataStore) CommitObject(ctx context.Context, req *lumavaultv1.CommitObjectRequest) (*lumavaultv1.ObjectMetadata, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	if err := invalidArg(validate.CommitRequest(req)); err != nil {
		return nil, false, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	key := dedupKey{namespace: req.Namespace, sha256: req.Sha256Digest}
	if !req.SkipDedup {
		if ids := s.dedupIndex[key]; len(ids) > 0 {
			return cloneObject(s.objects[ids[0]]), true, nil
		}
	}

	id, err := newUUIDv4()
	if err != nil {
		return nil, false, fmt.Errorf("metadata: generate object id: %w", err)
	}
	if _, exists := s.objects[id]; exists {
		return nil, false, fmt.Errorf("%w: object ID %q already exists", ErrInvalidArgument, id)
	}

	ts := timestamppb.New(time.Now().UTC())
	obj := &lumavaultv1.ObjectMetadata{
		Id:                 id,
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

	// Persist to disk before mutating in-memory state so a failed write needs no rollback.
	if err := s.writeObjectFile(obj); err != nil {
		return nil, false, err
	}

	s.objects[id] = obj
	s.insertDedupID(key, obj)
	s.adjustChunkRefs(obj, +1)

	return cloneObject(obj), false, nil
}

// GetObject retrieves a single object's metadata by ID.
func (s *LocalMetadataStore) GetObject(ctx context.Context, objectID string) (*lumavaultv1.ObjectMetadata, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if validate.ObjectID(objectID) != nil {
		return nil, fmt.Errorf("%w: invalid object_id %q", ErrInvalidArgument, objectID)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	obj, ok := s.objects[objectID]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrObjectNotFound, objectID)
	}
	return cloneObject(obj), nil
}

// ListObjects lists objects within a namespace with deterministic cursor pagination.
func (s *LocalMetadataStore) ListObjects(ctx context.Context, req *lumavaultv1.ListObjectsRequest) (*lumavaultv1.ListObjectsResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if req == nil {
		return nil, fmt.Errorf("%w: request is nil", ErrInvalidArgument)
	}
	if validate.Namespace(req.Namespace) != nil {
		return nil, fmt.Errorf("%w: valid namespace is required", ErrInvalidArgument)
	}
	if req.PageSize < 0 {
		return nil, fmt.Errorf("%w: page_size (%d) must not be negative", ErrInvalidArgument, req.PageSize)
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

	s.mu.RLock()
	defer s.mu.RUnlock()

	var matched []*lumavaultv1.ObjectMetadata
	for _, obj := range s.objects {
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
		nextToken = encodePageToken(matched[endIdx-1])
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

// UpdateObjectMetadata partially updates mutable storage-level metadata fields
// (filename, mime_type, thumbnail_chunk_hash) using a FieldMask and atomically persists
// the updated ObjectMetadata to disk.
func (s *LocalMetadataStore) UpdateObjectMetadata(ctx context.Context, req *lumavaultv1.UpdateObjectMetadataRequest) (*lumavaultv1.ObjectMetadata, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if req == nil || req.Object == nil || validate.ObjectID(req.Object.Id) != nil {
		return nil, fmt.Errorf("%w: object and valid object.id are required", ErrInvalidArgument)
	}
	if req.UpdateMask == nil || len(req.UpdateMask.Paths) == 0 {
		return nil, fmt.Errorf("%w: non-empty update_mask is required", ErrInvalidArgument)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	existing, ok := s.objects[req.Object.Id]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrObjectNotFound, req.Object.Id)
	}

	updated := cloneObject(existing)
	for _, path := range req.UpdateMask.Paths {
		if err := applyFieldMaskPath(updated, req.Object, path); err != nil {
			return nil, err
		}
	}
	updated.UpdatedAt = timestamppb.New(time.Now().UTC())

	// Persist to disk before mutating in-memory state so a failed write needs no rollback.
	if err := s.writeObjectFile(updated); err != nil {
		return nil, err
	}

	if existing.ThumbnailChunkHash != updated.ThumbnailChunkHash {
		s.adjustChunkRefs(existing, -1)
		s.adjustChunkRefs(updated, +1)
	}

	s.objects[updated.Id] = updated
	return cloneObject(updated), nil
}

// DeleteObject removes an object's metadata file from disk and updates in-memory indexes
// and chunk reference counts.
func (s *LocalMetadataStore) DeleteObject(ctx context.Context, objectID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if validate.ObjectID(objectID) != nil {
		return fmt.Errorf("%w: invalid object_id %q", ErrInvalidArgument, objectID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	existing, ok := s.objects[objectID]
	if !ok {
		return fmt.Errorf("%w: %q", ErrObjectNotFound, objectID)
	}

	if err := os.Remove(s.objectFilePath(objectID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("metadata: remove object file %s: %w", objectID, err)
	}

	delete(s.objects, objectID)

	// Remove objectID from the oldest-first slice; if others remain, ids[0] is the oldest remaining object.
	key := dedupKey{namespace: existing.Namespace, sha256: existing.Sha256Digest}
	if ids := slices.DeleteFunc(s.dedupIndex[key], func(id string) bool { return id == objectID }); len(ids) > 0 {
		s.dedupIndex[key] = ids
	} else {
		delete(s.dedupIndex, key)
	}

	s.adjustChunkRefs(existing, -1)
	return nil
}

// IsChunkReferenced checks whether hash is currently referenced by any committed object.
func (s *LocalMetadataStore) IsChunkReferenced(ctx context.Context, hash string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if err := invalidArg(validate.Hash(hash)); err != nil {
		return false, err
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.chunkRefs[hash] > 0, nil
}

// loadFromDisk reads all <id>.pb manifests in objectsDir, verifies each filename matches
// its embedded ObjectMetadata.Id, and rebuilds the in-memory indexes.
func (s *LocalMetadataStore) loadFromDisk() error {
	entries, err := os.ReadDir(s.objectsDir)
	if err != nil {
		return fmt.Errorf("metadata: read objects dir: %w", err)
	}

	var loaded []*lumavaultv1.ObjectMetadata
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".pb") {
			continue
		}
		expectedID := strings.TrimSuffix(entry.Name(), ".pb")
		path := filepath.Join(s.objectsDir, entry.Name())
		raw, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("metadata: read object file %s: %w", entry.Name(), err)
		}
		obj := &lumavaultv1.ObjectMetadata{}
		if err := proto.Unmarshal(raw, obj); err != nil {
			return fmt.Errorf("metadata: unmarshal object file %s: %w", entry.Name(), err)
		}
		if obj.Id != expectedID || validate.ObjectID(obj.Id) != nil {
			return fmt.Errorf("metadata: object file %s has mismatched or unsafe id %q", entry.Name(), obj.Id)
		}
		loaded = append(loaded, obj)
	}

	// Sort oldest-first (CreatedAt ASC, Id ASC) so deduplication slice order is deterministic across restarts.
	sort.Slice(loaded, func(i, j int) bool {
		return compareObjectsAsc(loaded[i], loaded[j]) < 0
	})

	for _, obj := range loaded {
		s.objects[obj.Id] = obj
		key := dedupKey{namespace: obj.Namespace, sha256: obj.Sha256Digest}
		s.dedupIndex[key] = append(s.dedupIndex[key], obj.Id)
		s.adjustChunkRefs(obj, +1)
	}

	return nil
}

// insertDedupID inserts obj.Id into dedupIndex[key] in oldest-first (CreatedAt ASC, Id ASC) order.
func (s *LocalMetadataStore) insertDedupID(key dedupKey, obj *lumavaultv1.ObjectMetadata) {
	ids := s.dedupIndex[key]
	idx, _ := slices.BinarySearchFunc(ids, obj, func(existingID string, target *lumavaultv1.ObjectMetadata) int {
		return compareObjectsAsc(s.objects[existingID], target)
	})
	s.dedupIndex[key] = slices.Insert(ids, idx, obj.Id)
}

// adjustChunkRefs increments or decrements per-object unique chunk reference counts in
// s.chunkRefs across chunk_hashes and thumbnail_chunk_hash, removing entries whose count drops to zero.
func (s *LocalMetadataStore) adjustChunkRefs(obj *lumavaultv1.ObjectMetadata, delta int) {
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
		next := s.chunkRefs[h] + delta
		if next <= 0 {
			delete(s.chunkRefs, h)
		} else {
			s.chunkRefs[h] = next
		}
	}
}

// objectFilePath returns the <objectsDir>/<objectID>.pb path for an object manifest.
func (s *LocalMetadataStore) objectFilePath(objectID string) string {
	return filepath.Join(s.objectsDir, objectID+".pb")
}

// writeObjectFile marshals obj to binary Protobuf and writes it atomically to <objectsDir>/<id>.pb.
func (s *LocalMetadataStore) writeObjectFile(obj *lumavaultv1.ObjectMetadata) error {
	if validate.ObjectID(obj.Id) != nil {
		return fmt.Errorf("%w: unsafe object_id %q", ErrInvalidArgument, obj.Id)
	}
	raw, err := proto.Marshal(obj)
	if err != nil {
		return fmt.Errorf("metadata: marshal object %s: %w", obj.Id, err)
	}
	return s.writeFileAtomic(s.objectFilePath(obj.Id), raw)
}

// writeFileAtomic stages data in tmpDir, fsyncs it, and atomically renames it over destPath.
func (s *LocalMetadataStore) writeFileAtomic(destPath string, data []byte) (retErr error) {
	tmpFile, err := os.CreateTemp(s.tmpDir, "meta-*")
	if err != nil {
		return fmt.Errorf("metadata: create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	closed := false

	defer func() {
		if !closed {
			_ = tmpFile.Close()
		}
		if retErr != nil {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := tmpFile.Write(data); err != nil {
		return fmt.Errorf("metadata: write temp file: %w", err)
	}
	// os.CreateTemp creates files with 0600 (owner-only); widen to 0644 (rw-r--r--) before publishing.
	if err := tmpFile.Chmod(0o644); err != nil {
		return fmt.Errorf("metadata: chmod temp file: %w", err)
	}
	if err := tmpFile.Sync(); err != nil {
		return fmt.Errorf("metadata: sync temp file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("metadata: close temp file: %w", err)
	}
	closed = true

	if err := os.Rename(tmpPath, destPath); err != nil {
		return fmt.Errorf("metadata: rename temp file to %s: %w", filepath.Base(destPath), err)
	}
	return nil
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
			if err := invalidArg(validate.Hash(src.ThumbnailChunkHash)); err != nil {
				return fmt.Errorf("thumbnail_chunk_hash: %w", err)
			}
		}
		updated.ThumbnailChunkHash = src.ThumbnailChunkHash
	default:
		return fmt.Errorf("%w: unsupported or immutable update_mask path %q", ErrInvalidArgument, path)
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
		return nil, fmt.Errorf("%w: invalid page_token encoding: %v", ErrInvalidArgument, err)
	}
	var c pageCursor
	if err := json.Unmarshal(b, &c); err != nil || c.ID == "" {
		return nil, fmt.Errorf("%w: malformed page_token payload", ErrInvalidArgument)
	}
	return &c, nil
}

// cloneObject returns a deep Protobuf copy of obj so callers cannot mutate store state.
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

// newUUIDv4 generates a random RFC 4122 version-4 UUID string.
func newUUIDv4() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40 // Version 4
	b[8] = (b[8] & 0x3f) | 0x80 // Variant 10
	var buf [36]byte
	hex.Encode(buf[0:8], b[0:4])
	buf[8] = '-'
	hex.Encode(buf[9:13], b[4:6])
	buf[13] = '-'
	hex.Encode(buf[14:18], b[6:8])
	buf[18] = '-'
	hex.Encode(buf[19:23], b[8:10])
	buf[23] = '-'
	hex.Encode(buf[24:36], b[10:16])
	return string(buf[:]), nil
}

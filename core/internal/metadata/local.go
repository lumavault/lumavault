package metadata

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
	"github.com/lumavault/lumavault/core/internal/validate"
	"google.golang.org/protobuf/proto"
)

const (
	objectsSubdir = "objects"
	tmpSubdir     = "tmp"
)

// Compile-time check that LocalMetadataStore implements MetadataStore.
var _ MetadataStore = (*LocalMetadataStore)(nil)

// LocalMetadataStore is the Day-1 filesystem-backed MetadataStore implementation.
// It delegates deterministic validation, indexing, and reference counting to an in-memory
// Engine protected by a sync.RWMutex, and persists one atomic binary Protobuf file per object
// under <rootDir>/objects/<id>.pb.
type LocalMetadataStore struct {
	objectsDir string
	tmpDir     string

	mu     sync.RWMutex
	engine *Engine
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
		engine:     NewEngine(),
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
	if req == nil {
		return nil, false, fmt.Errorf("%w: request is nil", validate.ErrInvalid)
	}

	id, err := newUUIDv4()
	if err != nil {
		return nil, false, fmt.Errorf("metadata: generate object id: %w", err)
	}
	now := time.Now().UTC()

	s.mu.Lock()
	defer s.mu.Unlock()

	obj, deduplicated, err := s.engine.CommitObject(req, id, now)
	if err != nil {
		return nil, false, err
	}
	if deduplicated {
		return obj, true, nil
	}

	if err := s.writeObjectFile(obj); err != nil {
		_ = s.engine.DeleteObject(obj.Id)
		return nil, false, err
	}

	return obj, false, nil
}

// GetObject retrieves a single object's metadata by ID.
func (s *LocalMetadataStore) GetObject(ctx context.Context, objectID string) (*lumavaultv1.ObjectMetadata, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.engine.GetObject(objectID)
}

// ListObjects lists objects within a namespace with deterministic cursor pagination.
func (s *LocalMetadataStore) ListObjects(ctx context.Context, req *lumavaultv1.ListObjectsRequest) (*lumavaultv1.ListObjectsResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.engine.ListObjects(req)
}

// UpdateObjectMetadata partially updates mutable storage-level metadata fields
// (filename, mime_type, thumbnail_chunk_hash) using a FieldMask and atomically persists
// the updated ObjectMetadata to disk.
func (s *LocalMetadataStore) UpdateObjectMetadata(ctx context.Context, req *lumavaultv1.UpdateObjectMetadataRequest) (*lumavaultv1.ObjectMetadata, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if req == nil || req.Object == nil {
		return nil, fmt.Errorf("%w: object is required", validate.ErrInvalid)
	}
	if err := validate.ObjectID(req.Object.Id); err != nil {
		return nil, err
	}

	now := time.Now().UTC()

	s.mu.Lock()
	defer s.mu.Unlock()

	prevObj, err := s.engine.GetObject(req.Object.Id)
	if err != nil {
		return nil, err
	}

	updated, err := s.engine.UpdateObjectMetadata(req, now)
	if err != nil {
		return nil, err
	}

	if err := s.writeObjectFile(updated); err != nil {
		s.engine.putObjectDirect(prevObj)
		return nil, err
	}

	return updated, nil
}

// DeleteObject removes an object's metadata file from disk and updates in-memory indexes
// and chunk reference counts.
func (s *LocalMetadataStore) DeleteObject(ctx context.Context, objectID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validate.ObjectID(objectID); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.engine.hasObject(objectID) {
		return fmt.Errorf("%w: %q", ErrObjectNotFound, objectID)
	}

	objPath := s.objectFilePath(objectID)
	if err := os.Remove(objPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("metadata: remove object file %s: %w", objectID, err)
	}

	return s.engine.DeleteObject(objectID)
}

// IsChunkReferenced checks whether hash is currently referenced by any committed object.
func (s *LocalMetadataStore) IsChunkReferenced(ctx context.Context, hash string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.engine.IsChunkReferenced(hash)
}

// loadFromDisk reads all <id>.pb manifests in objectsDir, verifies each filename matches
// its embedded ObjectMetadata.Id, and restores the in-memory Engine.
func (s *LocalMetadataStore) loadFromDisk() error {
	entries, err := os.ReadDir(s.objectsDir)
	if err != nil {
		return fmt.Errorf("metadata: read objects dir: %w", err)
	}

	var objects []*lumavaultv1.ObjectMetadata
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
		objects = append(objects, obj)
	}

	return s.engine.Restore(objects)
}

// objectFilePath returns the <objectsDir>/<objectID>.pb path for an object manifest.
func (s *LocalMetadataStore) objectFilePath(objectID string) string {
	return filepath.Join(s.objectsDir, objectID+".pb")
}

// writeObjectFile marshals obj to binary Protobuf and writes it atomically to <objectsDir>/<id>.pb.
func (s *LocalMetadataStore) writeObjectFile(obj *lumavaultv1.ObjectMetadata) error {
	if err := validate.ObjectID(obj.Id); err != nil {
		return err
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

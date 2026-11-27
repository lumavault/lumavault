package chunkstore

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/lumavault/lumavault/core/internal/constants"
	"github.com/lumavault/lumavault/core/internal/validate"
)

const (
	chunksSubdir = "chunks"
	tmpSubdir    = "tmp"
)

// LocalChunkStore implements ChunkStore backed by a sharded local filesystem directory.
type LocalChunkStore struct {
	mu        sync.RWMutex
	chunksDir string
	tmpDir    string
}

var _ ChunkStore = (*LocalChunkStore)(nil)

// NewLocalChunkStore initializes a LocalChunkStore rooted at rootDir, creating the
// sharded chunks directory and temporary upload staging directory if they do not exist.
func NewLocalChunkStore(rootDir string) (*LocalChunkStore, error) {
	if rootDir == "" {
		return nil, errors.New("chunkstore: rootDir must not be empty")
	}
	chunksDir := filepath.Join(rootDir, chunksSubdir)
	tmpDir := filepath.Join(rootDir, tmpSubdir)

	if err := os.MkdirAll(chunksDir, 0o755); err != nil {
		return nil, fmt.Errorf("chunkstore: create chunks dir: %w", err)
	}
	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		return nil, fmt.Errorf("chunkstore: create tmp dir: %w", err)
	}

	return &LocalChunkStore{
		chunksDir: chunksDir,
		tmpDir:    tmpDir,
	}, nil
}

// chunkPath shards chunks into two-level hex-prefix subdirectories (<chunks>/ab/cd/<hash>)
// so no single directory accumulates too many files.
func (s *LocalChunkStore) chunkPath(hash string) string {
	return filepath.Join(s.chunksDir, hash[0:2], hash[2:4], hash)
}

// PutChunk streams bytes from r in 32 KiB buffers into a temporary file while computing
// the SHA-256 digest on the fly, verifies the digest matches hash and does not exceed
// MaxChunkSizeBytes, atomically moves the file into the sharded store, and touches mtime.
func (s *LocalChunkStore) PutChunk(ctx context.Context, hash string, r io.Reader) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if err := validate.Hash(hash); err != nil {
		return 0, err
	}
	if r == nil {
		return 0, errors.New("chunkstore: reader must not be nil")
	}

	tmpFile, err := os.CreateTemp(s.tmpDir, "chunk-*.tmp")
	if err != nil {
		return 0, fmt.Errorf("chunkstore: create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	cleanupTmp := true
	defer func() {
		if cleanupTmp {
			_ = tmpFile.Close()
			_ = os.Remove(tmpPath)
		}
	}()

	hasher := sha256.New()
	buf := make([]byte, StreamBufferSize)
	var written int64

	for {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		n, readErr := r.Read(buf)
		if n > 0 {
			written += int64(n)
			if written > constants.MaxChunkSizeBytes {
				return 0, ErrChunkTooLarge
			}
			chunkSlice := buf[:n]
			if _, wErr := tmpFile.Write(chunkSlice); wErr != nil {
				return 0, fmt.Errorf("chunkstore: write temp file: %w", wErr)
			}
			_, _ = hasher.Write(chunkSlice)
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			return 0, fmt.Errorf("chunkstore: read stream: %w", readErr)
		}
	}

	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if actualHash != hash {
		return 0, ErrHashMismatch
	}

	// os.CreateTemp creates files with 0600 (owner-only); widen to 0644 (rw-r--r--) before publishing.
	if err := tmpFile.Chmod(0o644); err != nil {
		return 0, fmt.Errorf("chunkstore: chmod temp file: %w", err)
	}
	if err := tmpFile.Sync(); err != nil {
		return 0, fmt.Errorf("chunkstore: sync temp file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return 0, fmt.Errorf("chunkstore: close temp file: %w", err)
	}

	destPath := s.chunkPath(hash)
	// Create the <ab>/<cd> shard directories if missing (mkdir -p with rwxr-xr-x).
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return 0, fmt.Errorf("chunkstore: create shard dir: %w", err)
	}

	now := time.Now()
	if err := os.Chtimes(tmpPath, now, now); err != nil {
		return 0, fmt.Errorf("chunkstore: touch temp file mtime: %w", err)
	}

	s.mu.RLock()
	err = os.Rename(tmpPath, destPath)
	if err == nil {
		cleanupTmp = false
		err = os.Chtimes(destPath, now, now)
	}
	s.mu.RUnlock()
	if err != nil {
		return 0, fmt.Errorf("chunkstore: publish chunk file: %w", err)
	}

	return written, nil
}

// GetChunk opens the full chunk file for reading and returns its byte length.
func (s *LocalChunkStore) GetChunk(ctx context.Context, hash string) (io.ReadCloser, int64, error) {
	if err := ctx.Err(); err != nil {
		return nil, 0, err
	}
	if err := validate.Hash(hash); err != nil {
		return nil, 0, err
	}

	f, err := os.Open(s.chunkPath(hash))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, 0, ErrChunkNotFound
		}
		return nil, 0, fmt.Errorf("chunkstore: open chunk: %w", err)
	}

	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, 0, fmt.Errorf("chunkstore: stat chunk: %w", err)
	}

	return f, info.Size(), nil
}

type sectionReadCloser struct {
	*io.SectionReader
	closer io.Closer
}

func (s *sectionReadCloser) Close() error {
	return s.closer.Close()
}

// ReadChunkRange opens a sub-chunk byte range [offset, offset+length) using io.NewSectionReader.
func (s *LocalChunkStore) ReadChunkRange(ctx context.Context, hash string, offset int64, length int64) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validate.Hash(hash); err != nil {
		return nil, err
	}
	if offset < 0 || length < 0 {
		return nil, ErrInvalidRange
	}

	f, err := os.Open(s.chunkPath(hash))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrChunkNotFound
		}
		return nil, fmt.Errorf("chunkstore: open chunk for range read: %w", err)
	}

	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("chunkstore: stat chunk for range read: %w", err)
	}

	size := info.Size()
	if offset > size || length > size-offset {
		_ = f.Close()
		return nil, ErrInvalidRange
	}

	return &sectionReadCloser{
		SectionReader: io.NewSectionReader(f, offset, length),
		closer:        f,
	}, nil
}

// HasChunks checks which of the candidate SHA-256 hashes are missing from disk, preserving
// order and deduplicating inputs. Existing chunks have their mtime refreshed to time.Now()
// in a single Chtimes syscall to renew their 24-hour garbage collection grace lease.
func (s *LocalChunkStore) HasChunks(ctx context.Context, hashes []string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	for _, h := range hashes {
		if err := validate.Hash(h); err != nil {
			return nil, err
		}
	}

	seen := make(map[string]struct{}, len(hashes))
	var missing []string
	now := time.Now()

	for _, h := range hashes {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if _, ok := seen[h]; ok {
			continue
		}
		seen[h] = struct{}{}

		path := s.chunkPath(h)
		s.mu.RLock()
		err := os.Chtimes(path, now, now)
		s.mu.RUnlock()
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				missing = append(missing, h)
				continue
			}
			return nil, fmt.Errorf("chunkstore: touch chunk mtime %s: %w", h, err)
		}
	}

	return missing, nil
}

// StatChunks returns the on-disk byte size for every requested hash, or ErrChunkNotFound
// if any hash is missing.
func (s *LocalChunkStore) StatChunks(ctx context.Context, hashes []string) (map[string]int64, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	for _, h := range hashes {
		if err := validate.Hash(h); err != nil {
			return nil, err
		}
	}

	sizes := make(map[string]int64, len(hashes))
	for _, h := range hashes {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if _, ok := sizes[h]; ok {
			continue
		}
		info, err := os.Stat(s.chunkPath(h))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil, ErrChunkNotFound
			}
			return nil, fmt.Errorf("chunkstore: stat chunk %s: %w", h, err)
		}
		sizes[h] = info.Size()
	}

	return sizes, nil
}

// DeleteChunk removes a chunk file from disk. It returns nil if the chunk is already absent.
func (s *LocalChunkStore) DeleteChunk(ctx context.Context, hash string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validate.Hash(hash); err != nil {
		return err
	}

	s.mu.Lock()
	err := os.Remove(s.chunkPath(hash))
	s.mu.Unlock()
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("chunkstore: delete chunk %s: %w", hash, err)
	}
	return nil
}

// GarbageCollect walks stored chunks and temporary files, removing any unreferenced chunk
// or stale temporary upload file whose mtime is older than gracePeriod.
func (s *LocalChunkStore) GarbageCollect(ctx context.Context, isReferenced func(hash string) (bool, error), gracePeriod time.Duration) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if isReferenced == nil {
		return 0, errors.New("chunkstore: isReferenced predicate must not be nil")
	}
	if gracePeriod < 0 {
		return 0, errors.New("chunkstore: gracePeriod must not be negative")
	}

	cutoff := time.Now().Add(-gracePeriod)
	deleted := 0

	err := filepath.WalkDir(s.chunksDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, os.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}

		hash := d.Name()
		if err := validate.Hash(hash); err != nil {
			return nil
		}

		info, err := d.Info()
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}

		if !info.ModTime().Before(cutoff) {
			return nil
		}

		referenced, err := isReferenced(hash)
		if err != nil {
			return fmt.Errorf("chunkstore: check reference for %s: %w", hash, err)
		}
		if referenced {
			return nil
		}

		// Re-check mtime under write lock so a concurrent HasChunks or PutChunk lease
		// renewal cannot race with os.Remove.
		s.mu.Lock()
		freshInfo, statErr := os.Stat(path)
		if statErr != nil {
			s.mu.Unlock()
			if errors.Is(statErr, os.ErrNotExist) {
				return nil
			}
			return fmt.Errorf("chunkstore: stat unreferenced chunk %s: %w", hash, statErr)
		}
		if !freshInfo.ModTime().Before(cutoff) {
			s.mu.Unlock()
			return nil
		}
		rmErr := os.Remove(path)
		s.mu.Unlock()

		if rmErr != nil {
			if errors.Is(rmErr, os.ErrNotExist) {
				return nil
			}
			return fmt.Errorf("chunkstore: remove unreferenced chunk %s: %w", hash, rmErr)
		}
		deleted++
		return nil
	})
	if err != nil {
		return deleted, err
	}

	entries, err := os.ReadDir(s.tmpDir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return deleted, fmt.Errorf("chunkstore: read tmp dir: %w", err)
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return deleted, err
		}
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			tmpPath := filepath.Join(s.tmpDir, entry.Name())
			if err := os.Remove(tmpPath); err == nil {
				deleted++
			}
		}
	}

	return deleted, nil
}

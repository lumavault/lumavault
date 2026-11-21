package chunkstore

import (
	"context"
	"errors"
	"io"
	"time"
)

const (
	// StreamBufferSize is the buffer size (32 KiB) used when streaming chunk uploads to disk.
	StreamBufferSize int = 32 << 10
)

var (
	// ErrChunkNotFound is returned when a requested SHA-256 chunk does not exist in the store.
	ErrChunkNotFound = errors.New("chunkstore: chunk not found")
	// ErrInvalidHash is returned when a hash is not a valid 64-character lowercase hex SHA-256 digest.
	ErrInvalidHash = errors.New("chunkstore: invalid sha256 hex digest")
	// ErrHashMismatch is returned when a streamed payload's computed SHA-256 does not match the expected hash.
	ErrHashMismatch = errors.New("chunkstore: payload sha256 digest mismatch")
	// ErrChunkTooLarge is returned when a streamed chunk exceeds MaxChunkSizeBytes (64 MiB).
	ErrChunkTooLarge = errors.New("chunkstore: chunk exceeds maximum size of 64 MiB")
	// ErrInvalidRange is returned when a sub-chunk byte range is negative or exceeds the chunk size.
	ErrInvalidRange = errors.New("chunkstore: invalid byte range")
)

// ChunkStore defines the pluggable Data Plane contract for content-addressed single-chunk storage.
// Implementations store immutable blobs keyed by their lowercase hex-encoded SHA-256 digest.
type ChunkStore interface {
	// PutChunk streams raw bytes from r in 32 KiB buffers, computes the SHA-256 digest on the fly,
	// enforces MaxChunkSizeBytes, verifies the digest matches hash, persists the chunk atomically,
	// and updates its modification time (mtime) to reset the garbage collection grace lease.
	PutChunk(ctx context.Context, hash string, r io.Reader) (int64, error)

	// GetChunk opens a full chunk stream by its SHA-256 hash and returns the reader and byte size.
	GetChunk(ctx context.Context, hash string) (io.ReadCloser, int64, error)

	// ReadChunkRange reads a sub-chunk byte range [offset, offset+length) without loading the
	// entire chunk into memory.
	ReadChunkRange(ctx context.Context, hash string, offset int64, length int64) (io.ReadCloser, error)

	// HasChunks checks which of the candidate SHA-256 hashes are missing from the store, preserving
	// input order and deduplicating repeated hashes. For every chunk that already exists, HasChunks
	// refreshes its mtime so resumed/deduplicated uploads receive a fresh GC grace window.
	HasChunks(ctx context.Context, hashes []string) ([]string, error)

	// StatChunks returns a map of hash -> byte size for all requested chunks, or returns
	// ErrChunkNotFound if any requested chunk does not exist.
	StatChunks(ctx context.Context, hashes []string) (map[string]int64, error)

	// DeleteChunk removes a chunk by its SHA-256 hash. It is idempotent if the chunk is already absent.
	DeleteChunk(ctx context.Context, hash string) error

	// GarbageCollect scans stored chunks and temporary upload files. Any chunk whose mtime is older
	// than gracePeriod is checked via isReferenced(hash) and deleted if unreferenced. Stale temporary
	// staging files older than gracePeriod are also removed. Returns the number of deleted files.
	GarbageCollect(ctx context.Context, isReferenced func(hash string) (bool, error), gracePeriod time.Duration) (int, error)
}

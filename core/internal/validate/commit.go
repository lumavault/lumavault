package validate

import (
	"fmt"

	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
	"github.com/lumavault/lumavault/core/internal/constants"
)

// CommitRequest checks a commit manifest without any I/O: namespace, every SHA-256 digest,
// chunk size bounds, a non-zero size_bytes, and that len(chunk_hashes) equals ceil(size_bytes / chunk_size_bytes).
func CommitRequest(req *lumavaultv1.CommitObjectRequest) error {
	if req == nil {
		return fmt.Errorf("%w: request is nil", ErrInvalid)
	}
	if err := Namespace(req.Namespace); err != nil {
		return err
	}

	if err := Hash(req.Sha256Digest); err != nil {
		return fmt.Errorf("sha256_digest: %w", err)
	}
	if req.ThumbnailChunkHash != "" {
		if err := Hash(req.ThumbnailChunkHash); err != nil {
			return fmt.Errorf("thumbnail_chunk_hash: %w", err)
		}
	}
	for i, h := range req.ChunkHashes {
		if err := Hash(h); err != nil {
			return fmt.Errorf("chunk_hashes[%d]: %w", i, err)
		}
	}

	if req.ChunkSizeBytes > constants.MaxChunkSizeBytes {
		return fmt.Errorf("%w: chunk_size_bytes (%d) exceeds max (%d)", ErrInvalid, req.ChunkSizeBytes, constants.MaxChunkSizeBytes)
	}

	// An empty photo, video, ROM, or save is always a mistake, such as a failed export.
	if req.SizeBytes == 0 {
		return fmt.Errorf("%w: size_bytes must be > 0", ErrInvalid)
	}
	if req.ChunkSizeBytes == 0 {
		return fmt.Errorf("%w: chunk_size_bytes must be > 0 when size_bytes > 0", ErrInvalid)
	}
	expectedChunks := 1 + (req.SizeBytes-1)/uint64(req.ChunkSizeBytes)
	if uint64(len(req.ChunkHashes)) != expectedChunks {
		return fmt.Errorf("%w: len(chunk_hashes)=%d does not match ceil(size_bytes=%d / chunk_size_bytes=%d)=%d",
			ErrInvalid, len(req.ChunkHashes), req.SizeBytes, req.ChunkSizeBytes, expectedChunks)
	}
	return nil
}

// ChunkSizes requires chunks 0..N-2 to be exactly chunk_size_bytes and the tail chunk
// to hold the remaining bytes. Callers must validate req with CommitRequest first.
func ChunkSizes(req *lumavaultv1.CommitObjectRequest, sizes map[string]int64) error {
	hashes := req.GetChunkHashes()
	n := len(hashes)
	chunkSize := int64(req.GetChunkSizeBytes())
	tail := int64(req.GetSizeBytes()) - int64(n-1)*chunkSize
	for i, h := range hashes {
		want := chunkSize
		if i == n-1 {
			want = tail
		}
		if got := sizes[h]; got != want {
			return fmt.Errorf("%w: chunk_hashes[%d] %s is %d bytes on disk, manifest expects %d",
				ErrInvalid, i, h, got, want)
		}
	}
	return nil
}

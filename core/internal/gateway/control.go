package gateway

import (
	"context"
	"slices"

	"connectrpc.com/connect/v2"
	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
	"github.com/lumavault/lumavault/core/internal/validate"
)

const updateMaskThumbnail = "thumbnail_chunk_hash"

// HasChunks reports which chunks the client still needs to upload. ChunkStore renews the
// GC lease on chunks that already exist.
func (g *gateway) HasChunks(ctx context.Context, req *lumavaultv1.HasChunksRequest) (*lumavaultv1.HasChunksResponse, error) {
	cred, err := g.rpcCredential(ctx)
	if err != nil {
		return nil, err
	}
	if !cred.upload() {
		return nil, denied("HasChunks")
	}
	missing, err := g.chunks.HasChunks(ctx, req.GetChunkHashes())
	if err != nil {
		return nil, toConnectError(ctx, err)
	}
	return &lumavaultv1.HasChunksResponse{MissingChunkHashes: missing}, nil
}

// CommitObject checks the manifest math, then verifies every referenced chunk exists with
// the exact size the manifest implies, and only then writes metadata. Size checks keep
// O(1) range seeking (offset / chunk_size_bytes) correct for every committed object.
func (g *gateway) CommitObject(ctx context.Context, req *lumavaultv1.CommitObjectRequest) (*lumavaultv1.CommitObjectResponse, error) {
	cred, err := g.rpcCredential(ctx)
	if err != nil {
		return nil, err
	}
	if err := allowCommit(cred, req); err != nil {
		return nil, err
	}
	if err := validate.CommitRequest(req); err != nil {
		return nil, toConnectError(ctx, err)
	}

	hashes := req.GetChunkHashes()
	if thumb := req.GetThumbnailChunkHash(); thumb != "" {
		hashes = append(slices.Clip(hashes), thumb)
	}
	if len(hashes) > 0 {
		sizes, err := g.chunks.StatChunks(ctx, hashes)
		if err != nil {
			return nil, toConnectError(ctx, err)
		}
		if err := checkChunkSizes(req, sizes); err != nil {
			return nil, err
		}
	}

	obj, deduplicated, err := g.meta.CommitObject(ctx, req)
	if err != nil {
		return nil, toConnectError(ctx, err)
	}
	return &lumavaultv1.CommitObjectResponse{Object: obj, Deduplicated: deduplicated}, nil
}

// checkChunkSizes requires chunks 0..N-2 to be exactly chunk_size_bytes and the tail chunk
// to hold the remaining bytes.
func checkChunkSizes(req *lumavaultv1.CommitObjectRequest, sizes map[string]int64) error {
	n := len(req.GetChunkHashes())
	if req.GetSizeBytes() == 0 || n == 0 {
		return nil
	}
	chunkSize := int64(req.GetChunkSizeBytes())
	tail := int64(req.GetSizeBytes()) - int64(n-1)*chunkSize
	for i, h := range req.GetChunkHashes() {
		want := chunkSize
		if i == n-1 {
			want = tail
		}
		if got := sizes[h]; got != want {
			return connect.Errorf(connect.CodeFailedPrecondition,
				"chunk_hashes[%d] %s is %d bytes on disk, manifest expects %d", i, h, got, want)
		}
	}
	return nil
}

// GetObject returns one object's manifest.
func (g *gateway) GetObject(ctx context.Context, req *lumavaultv1.GetObjectRequest) (*lumavaultv1.GetObjectResponse, error) {
	cred, err := g.rpcCredential(ctx)
	if err != nil {
		return nil, err
	}
	if !cred.readsObject(req.GetObjectId()) {
		return nil, denied("this object")
	}
	obj, err := g.meta.GetObject(ctx, req.GetObjectId())
	if err != nil {
		return nil, toConnectError(ctx, err)
	}
	return &lumavaultv1.GetObjectResponse{Object: obj}, nil
}

// ListObjects returns one page of objects in a namespace.
func (g *gateway) ListObjects(ctx context.Context, req *lumavaultv1.ListObjectsRequest) (*lumavaultv1.ListObjectsResponse, error) {
	if err := g.requireService(ctx, "ListObjects"); err != nil {
		return nil, err
	}
	res, err := g.meta.ListObjects(ctx, req)
	if err != nil {
		return nil, toConnectError(ctx, err)
	}
	return res, nil
}

// UpdateObjectMetadata applies a FieldMask update. A new non-empty thumbnail must already
// be uploaded so the object never points at a missing chunk.
func (g *gateway) UpdateObjectMetadata(ctx context.Context, req *lumavaultv1.UpdateObjectMetadataRequest) (*lumavaultv1.UpdateObjectMetadataResponse, error) {
	if err := g.requireService(ctx, "UpdateObjectMetadata"); err != nil {
		return nil, err
	}
	thumb := req.GetObject().GetThumbnailChunkHash()
	if thumb != "" && slices.Contains(req.GetUpdateMask().GetPaths(), updateMaskThumbnail) {
		if _, err := g.chunks.StatChunks(ctx, []string{thumb}); err != nil {
			return nil, toConnectError(ctx, err)
		}
	}
	obj, err := g.meta.UpdateObjectMetadata(ctx, req)
	if err != nil {
		return nil, toConnectError(ctx, err)
	}
	return &lumavaultv1.UpdateObjectMetadataResponse{Object: obj}, nil
}

// DeleteObject removes the manifest. Its chunks stay on disk until ChunkStore.GarbageCollect
// finds them unreferenced after the grace window.
func (g *gateway) DeleteObject(ctx context.Context, req *lumavaultv1.DeleteObjectRequest) (*lumavaultv1.DeleteObjectResponse, error) {
	if err := g.requireService(ctx, "DeleteObject"); err != nil {
		return nil, err
	}
	if err := g.meta.DeleteObject(ctx, req.GetObjectId()); err != nil {
		return nil, toConnectError(ctx, err)
	}
	return &lumavaultv1.DeleteObjectResponse{}, nil
}

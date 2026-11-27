package gateway

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"connectrpc.com/connect/v2"
	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

func (h *harness) wantNoObjects() {
	h.t.Helper()
	entries, err := os.ReadDir(filepath.Join(h.metaRoot, "objects"))
	if err != nil || len(entries) != 0 {
		h.t.Fatalf("expected no committed objects, got %v (err %v)", entries, err)
	}
}

func TestCommitInvalidMathSkipsChunkStore(t *testing.T) {
	h := newHarness(t)
	data := pattern(2500)
	_, hashes := split(data, 1000)

	cases := map[string]*lumavaultv1.CommitObjectRequest{
		"size with no chunks":   commitReq(data, 1000, nil),
		"too few chunks":        commitReq(data, 1000, hashes[:2]),
		"unspecified namespace": func() *lumavaultv1.CommitObjectRequest { r := commitReq(data, 1000, hashes); r.Namespace = 0; return r }(),
		"bad chunk hash":        commitReq(data, 1000, []string{hashes[0], "nothex", hashes[2]}),
		"chunk size too big":    commitReq(data, 64<<20+1, hashes[:1]),
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			h.chunks.reset()
			_, err := h.client.CommitObject(context.Background(), req)
			wantCode(t, err, connect.CodeInvalidArgument)
			if n := h.chunks.stats.Load(); n != 0 {
				t.Fatalf("StatChunks called %d times, want 0", n)
			}
		})
	}
	h.wantNoObjects()
}

func TestCommitMissingChunk(t *testing.T) {
	h := newHarness(t)
	data := pattern(2500)
	parts, hashes := split(data, 1000)
	h.putChunk(parts[0])
	h.putChunk(parts[2])

	_, err := h.client.CommitObject(context.Background(), commitReq(data, 1000, hashes))
	wantCode(t, err, connect.CodeFailedPrecondition)
	h.wantNoObjects()
}

func TestCommitMissingThumbnail(t *testing.T) {
	h := newHarness(t)
	data := pattern(2500)
	parts, hashes := split(data, 1000)
	for _, p := range parts {
		h.putChunk(p)
	}
	req := commitReq(data, 1000, hashes)
	req.ThumbnailChunkHash = sha([]byte("never uploaded"))

	_, err := h.client.CommitObject(context.Background(), req)
	wantCode(t, err, connect.CodeFailedPrecondition)
	h.wantNoObjects()
}

func TestCommitChunkSizeMismatch(t *testing.T) {
	h := newHarness(t)
	a, b, c := pattern(1000), pattern(999), pattern(500)
	for _, p := range [][]byte{a, b, c} {
		h.putChunk(p)
	}

	t.Run("interior chunk short", func(t *testing.T) {
		req := commitReq(make([]byte, 2500), 1000, []string{sha(a), sha(b), sha(c)})
		_, err := h.client.CommitObject(context.Background(), req)
		wantCode(t, err, connect.CodeFailedPrecondition)
	})
	t.Run("tail chunk wrong size", func(t *testing.T) {
		req := commitReq(make([]byte, 2400), 1000, []string{sha(a), sha(a), sha(c)})
		_, err := h.client.CommitObject(context.Background(), req)
		wantCode(t, err, connect.CodeFailedPrecondition)
	})
	h.wantNoObjects()
}

func TestCommitEmptyObjectRejected(t *testing.T) {
	h := newHarness(t)
	_, err := h.client.CommitObject(context.Background(), commitReq(nil, 0, nil))
	wantCode(t, err, connect.CodeInvalidArgument)
	if n := h.chunks.stats.Load(); n != 0 {
		t.Fatalf("StatChunks called %d times for empty object, want 0", n)
	}
	h.wantNoObjects()
}

func TestLegacyEmptyObjectStillLoads(t *testing.T) {
	legacy := legacyEmptyObject()
	h := newHarness(t, legacy)
	got, err := h.client.GetObject(context.Background(), &lumavaultv1.GetObjectRequest{ObjectId: legacy.GetId()})
	if err != nil || got.GetObject().GetSizeBytes() != 0 {
		t.Fatalf("GetObject on stored empty object: %v %v", got, err)
	}
}

func TestUpdateMissingThumbnail(t *testing.T) {
	h := newHarness(t)
	obj := h.upload(pattern(10), 10)
	_, err := h.client.UpdateObjectMetadata(context.Background(), &lumavaultv1.UpdateObjectMetadataRequest{
		Object:     &lumavaultv1.ObjectMetadata{Id: obj.GetId(), ThumbnailChunkHash: sha([]byte("missing"))},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"thumbnail_chunk_hash"}},
	})
	wantCode(t, err, connect.CodeFailedPrecondition)

	// A thumbnail value outside the mask is ignored, so no chunk check happens.
	h.chunks.reset()
	_, err = h.client.UpdateObjectMetadata(context.Background(), &lumavaultv1.UpdateObjectMetadataRequest{
		Object:     &lumavaultv1.ObjectMetadata{Id: obj.GetId(), Filename: "x", ThumbnailChunkHash: sha([]byte("missing"))},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"filename"}},
	})
	if err != nil || h.chunks.stats.Load() != 0 {
		t.Fatalf("filename-only update: err %v, stats %d", err, h.chunks.stats.Load())
	}
}

func TestControlErrorMapping(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	_, err := h.client.GetObject(ctx, &lumavaultv1.GetObjectRequest{ObjectId: "../etc"})
	wantCode(t, err, connect.CodeInvalidArgument)
	_, err = h.client.GetObject(ctx, &lumavaultv1.GetObjectRequest{ObjectId: "nope"})
	wantCode(t, err, connect.CodeNotFound)
	_, err = h.client.DeleteObject(ctx, &lumavaultv1.DeleteObjectRequest{ObjectId: "nope"})
	wantCode(t, err, connect.CodeNotFound)
	_, err = h.client.HasChunks(ctx, &lumavaultv1.HasChunksRequest{ChunkHashes: []string{"ZZ"}})
	wantCode(t, err, connect.CodeInvalidArgument)
}

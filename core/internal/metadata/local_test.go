package metadata

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
	"github.com/lumavault/lumavault/core/internal/constants"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func testHash(label string) string {
	sum := sha256.Sum256([]byte(label))
	return hex.EncodeToString(sum[:])
}

func TestCommitObject_Validation(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store, err := NewLocalMetadataStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewLocalMetadataStore: %v", err)
	}

	validDigest := testHash("file-digest")
	chunk0 := testHash("chunk-0")
	chunk1 := testHash("chunk-1")

	tests := []struct {
		name    string
		req     *lumavaultv1.CommitObjectRequest
		wantErr error
	}{
		{
			name:    "nil request",
			req:     nil,
			wantErr: ErrInvalidArgument,
		},
		{
			name: "unspecified namespace",
			req: &lumavaultv1.CommitObjectRequest{
				Namespace:      lumavaultv1.Namespace_NAMESPACE_UNSPECIFIED,
				SizeBytes:      1024,
				ChunkSizeBytes: 4 << 20,
				Sha256Digest:   validDigest,
				ChunkHashes:    []string{chunk0},
			},
			wantErr: ErrInvalidArgument,
		},
		{
			name: "invalid sha256_digest",
			req: &lumavaultv1.CommitObjectRequest{
				Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
				SizeBytes:      1024,
				ChunkSizeBytes: 4 << 20,
				Sha256Digest:   "INVALID_HASH",
				ChunkHashes:    []string{chunk0},
			},
			wantErr: ErrInvalidArgument,
		},
		{
			name: "invalid chunk_hash element",
			req: &lumavaultv1.CommitObjectRequest{
				Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
				SizeBytes:      1024,
				ChunkSizeBytes: 4 << 20,
				Sha256Digest:   validDigest,
				ChunkHashes:    []string{"not-a-sha256"},
			},
			wantErr: ErrInvalidArgument,
		},
		{
			name: "invalid thumbnail_chunk_hash",
			req: &lumavaultv1.CommitObjectRequest{
				Namespace:          lumavaultv1.Namespace_NAMESPACE_PHOTOS,
				SizeBytes:          1024,
				ChunkSizeBytes:     4 << 20,
				Sha256Digest:       validDigest,
				ChunkHashes:        []string{chunk0},
				ThumbnailChunkHash: "UPPERCASE_OR_SHORT",
			},
			wantErr: ErrInvalidArgument,
		},
		{
			name: "chunk_size_bytes == 0 when size_bytes > 0",
			req: &lumavaultv1.CommitObjectRequest{
				Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
				SizeBytes:      1024,
				ChunkSizeBytes: 0,
				Sha256Digest:   validDigest,
				ChunkHashes:    []string{chunk0},
			},
			wantErr: ErrInvalidArgument,
		},
		{
			name: "chunk_size_bytes exceeds 64 MiB",
			req: &lumavaultv1.CommitObjectRequest{
				Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
				SizeBytes:      1024,
				ChunkSizeBytes: constants.MaxChunkSizeBytes + 1,
				Sha256Digest:   validDigest,
				ChunkHashes:    []string{chunk0},
			},
			wantErr: ErrInvalidArgument,
		},
		{
			name: "chunk count mismatch (expects 2 chunks, got 1)",
			req: &lumavaultv1.CommitObjectRequest{
				Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
				SizeBytes:      (4 << 20) + 1,
				ChunkSizeBytes: 4 << 20,
				Sha256Digest:   validDigest,
				ChunkHashes:    []string{chunk0},
			},
			wantErr: ErrInvalidArgument,
		},
		{
			name: "zero size_bytes",
			req: &lumavaultv1.CommitObjectRequest{
				Namespace:    lumavaultv1.Namespace_NAMESPACE_PHOTOS,
				SizeBytes:    0,
				Sha256Digest: validDigest,
			},
			wantErr: ErrInvalidArgument,
		},
		{
			name: "zero size_bytes with non-empty chunk_hashes",
			req: &lumavaultv1.CommitObjectRequest{
				Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
				SizeBytes:      0,
				ChunkSizeBytes: 4 << 20,
				Sha256Digest:   validDigest,
				ChunkHashes:    []string{chunk0},
			},
			wantErr: ErrInvalidArgument,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := store.CommitObject(ctx, tc.req)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("got err=%v, want %v", err, tc.wantErr)
			}
		})
	}

	// Verify exact boundary chunk math: size_bytes == 2 * chunk_size_bytes requires 2 chunks.
	obj, dedup, err := store.CommitObject(ctx, &lumavaultv1.CommitObjectRequest{
		Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		Filename:       "exact.jpg",
		SizeBytes:      8 << 20,
		ChunkSizeBytes: 4 << 20,
		Sha256Digest:   validDigest,
		ChunkHashes:    []string{chunk0, chunk1},
	})
	if err != nil || dedup || obj.Id == "" {
		t.Fatalf("expected valid boundary CommitObject to succeed, got obj=%v dedup=%v err=%v", obj, dedup, err)
	}
}

func TestCommitObject_DeduplicationSkipDedupChunkRefsAndPersistenceReload(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	rootDir := t.TempDir()
	store, err := NewLocalMetadataStore(rootDir)
	if err != nil {
		t.Fatalf("NewLocalMetadataStore: %v", err)
	}

	sharedChunk := testHash("shared-chunk")
	uniqueChunk := testHash("unique-chunk")
	thumbChunk := testHash("thumb-chunk")
	photoDigest := testHash("photo-1")

	req := &lumavaultv1.CommitObjectRequest{
		Namespace:          lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		Filename:           "IMG_0001.HEIC",
		MimeType:           "image/heic",
		SizeBytes:          4 << 20,
		ChunkSizeBytes:     4 << 20,
		Sha256Digest:       photoDigest,
		ChunkHashes:        []string{sharedChunk},
		ThumbnailChunkHash: thumbChunk,
	}

	first, dedup, err := store.CommitObject(ctx, req)
	if err != nil || dedup {
		t.Fatalf("first CommitObject: dedup=%v err=%v", dedup, err)
	}

	// Second commit with same (NAMESPACE_PHOTOS, sha256_digest) must deduplicate.
	second, dedup, err := store.CommitObject(ctx, req)
	if err != nil || !dedup || second.Id != first.Id {
		t.Fatalf("expected second commit deduplicated=true with ID %q, got dedup=%v id=%q err=%v", first.Id, dedup, second.Id, err)
	}

	// Reload LocalMetadataStore on the same directory and verify deduplication and chunkRefs survive restart.
	store, err = NewLocalMetadataStore(rootDir)
	if err != nil {
		t.Fatalf("NewLocalMetadataStore reload: %v", err)
	}
	third, dedup, err := store.CommitObject(ctx, req)
	if err != nil || !dedup || third.Id != first.Id {
		t.Fatalf("expected post-reload commit deduplicated=true with ID %q, got dedup=%v id=%q err=%v", first.Id, dedup, third.Id, err)
	}

	// Commit with SkipDedup=true (e.g. versioned game saves sharing identical bytes) creates distinct objects.
	saveReq := &lumavaultv1.CommitObjectRequest{
		Namespace:      lumavaultv1.Namespace_NAMESPACE_GAMES,
		Filename:       "emerald.sav",
		MimeType:       "application/octet-stream",
		SizeBytes:      8 << 20,
		ChunkSizeBytes: 4 << 20,
		Sha256Digest:   testHash("save-1"),
		ChunkHashes:    []string{sharedChunk, uniqueChunk},
		SkipDedup:      true,
	}
	save1, dedup, err := store.CommitObject(ctx, saveReq)
	if err != nil || dedup {
		t.Fatalf("save1 CommitObject: dedup=%v err=%v", dedup, err)
	}
	save2, dedup, err := store.CommitObject(ctx, saveReq)
	if err != nil || dedup || save2.Id == save1.Id {
		t.Fatalf("expected save2 with SkipDedup=true to create distinct object, got dedup=%v id=%s", dedup, save2.Id)
	}
	if err := store.DeleteObject(ctx, save2.Id); err != nil {
		t.Fatalf("DeleteObject save2: %v", err)
	}

	// Check chunk references while both first (photo) and save1 exist.
	for _, h := range []string{sharedChunk, uniqueChunk, thumbChunk} {
		ref, err := store.IsChunkReferenced(ctx, h)
		if err != nil || !ref {
			t.Fatalf("expected chunk %s to be referenced, got ref=%v err=%v", h, ref, err)
		}
	}

	// Delete the photo object: thumbChunk becomes unreferenced, but sharedChunk remains referenced by save1.
	if err := store.DeleteObject(ctx, first.Id); err != nil {
		t.Fatalf("DeleteObject first: %v", err)
	}
	if ref, err := store.IsChunkReferenced(ctx, thumbChunk); err != nil || ref {
		t.Fatalf("expected thumbChunk to be unreferenced after photo deletion, got ref=%v err=%v", ref, err)
	}
	if ref, err := store.IsChunkReferenced(ctx, sharedChunk); err != nil || !ref {
		t.Fatalf("expected sharedChunk to remain referenced by save1, got ref=%v err=%v", ref, err)
	}

	// Re-committing the photo after deletion must create a new object (deduplicated=false).
	recommitted, dedup, err := store.CommitObject(ctx, req)
	if err != nil || dedup || recommitted.Id == first.Id {
		t.Fatalf("expected recommit after delete to create new object, got dedup=%v id=%s err=%v", dedup, recommitted.Id, err)
	}
	if err := store.DeleteObject(ctx, recommitted.Id); err != nil {
		t.Fatalf("DeleteObject recommitted: %v", err)
	}
	if err := store.DeleteObject(ctx, save1.Id); err != nil {
		t.Fatalf("DeleteObject save1: %v", err)
	}

	// Now sharedChunk and uniqueChunk must both be unreferenced.
	for _, h := range []string{sharedChunk, uniqueChunk} {
		if ref, err := store.IsChunkReferenced(ctx, h); err != nil || ref {
			t.Fatalf("expected chunk %s to be unreferenced after all objects deleted, got ref=%v err=%v", h, ref, err)
		}
	}
}

func TestConcurrentCommitsAndReads(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store, err := NewLocalMetadataStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewLocalMetadataStore: %v", err)
	}

	const workers = 12
	var wg sync.WaitGroup
	ids := make(chan string, workers)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			chunk := testHash(fmt.Sprintf("concurrent-chunk-%d", idx))
			obj, dedup, err := store.CommitObject(ctx, &lumavaultv1.CommitObjectRequest{
				Namespace:      lumavaultv1.Namespace_NAMESPACE_GAMES,
				Filename:       fmt.Sprintf("save_%d.sav", idx),
				SizeBytes:      65536,
				ChunkSizeBytes: 4 << 20,
				Sha256Digest:   testHash("shared-save-digest"),
				ChunkHashes:    []string{chunk},
				SkipDedup:      true,
			})
			if err != nil || dedup {
				t.Errorf("worker %d: dedup=%v err=%v", idx, dedup, err)
				return
			}
			ids <- obj.Id
		}(i)
	}
	wg.Wait()
	close(ids)

	seen := make(map[string]bool, workers)
	for id := range ids {
		if seen[id] {
			t.Fatalf("duplicate object ID %q", id)
		}
		seen[id] = true
	}
	if len(seen) != workers {
		t.Fatalf("expected %d committed objects, got %d", workers, len(seen))
	}
}

func TestUpdateObjectMetadata_FieldMask(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store, err := NewLocalMetadataStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewLocalMetadataStore: %v", err)
	}

	chunk := testHash("chunk-a")
	oldThumb := testHash("thumb-old")
	newThumb := testHash("thumb-new")

	photo, _, err := store.CommitObject(ctx, &lumavaultv1.CommitObjectRequest{
		Namespace:          lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		Filename:           "before.jpg",
		MimeType:           "image/jpeg",
		SizeBytes:          2048,
		ChunkSizeBytes:     4 << 20,
		Sha256Digest:       testHash("photo-update-test"),
		ChunkHashes:        []string{chunk},
		ThumbnailChunkHash: oldThumb,
	})
	if err != nil {
		t.Fatalf("CommitObject photo: %v", err)
	}

	// Reject empty update_mask or immutable fields.
	if _, err := store.UpdateObjectMetadata(ctx, &lumavaultv1.UpdateObjectMetadataRequest{
		Object:     &lumavaultv1.ObjectMetadata{Id: photo.Id, Filename: "ignored.jpg"},
		UpdateMask: &fieldmaskpb.FieldMask{},
	}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("expected ErrInvalidArgument on empty update_mask, got %v", err)
	}
	if _, err := store.UpdateObjectMetadata(ctx, &lumavaultv1.UpdateObjectMetadataRequest{
		Object:     &lumavaultv1.ObjectMetadata{Id: photo.Id, SizeBytes: 9999},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"size_bytes"}},
	}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("expected ErrInvalidArgument on immutable field size_bytes, got %v", err)
	}

	updatedPhoto, err := store.UpdateObjectMetadata(ctx, &lumavaultv1.UpdateObjectMetadataRequest{
		Object: &lumavaultv1.ObjectMetadata{
			Id:                 photo.Id,
			Filename:           "after.heic",
			MimeType:           "image/heic",
			ThumbnailChunkHash: newThumb,
		},
		UpdateMask: &fieldmaskpb.FieldMask{
			Paths: []string{"filename", "mime_type", "thumbnail_chunk_hash"},
		},
	})
	if err != nil {
		t.Fatalf("UpdateObjectMetadata: %v", err)
	}
	if updatedPhoto.Filename != "after.heic" || updatedPhoto.MimeType != "image/heic" || updatedPhoto.ThumbnailChunkHash != newThumb {
		t.Fatalf("unexpected updatedPhoto: %+v", updatedPhoto)
	}

	// Verify chunk refcounts adjusted from oldThumb to newThumb.
	if ref, err := store.IsChunkReferenced(ctx, oldThumb); err != nil || ref {
		t.Fatalf("expected oldThumb unreferenced, got ref=%v err=%v", ref, err)
	}
	if ref, err := store.IsChunkReferenced(ctx, newThumb); err != nil || !ref {
		t.Fatalf("expected newThumb referenced, got ref=%v err=%v", ref, err)
	}
}

func TestEngine_RestoreDeterminismAndDeepCloneIsolation(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store, err := NewLocalMetadataStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewLocalMetadataStore: %v", err)
	}

	chunk := testHash("clone-chunk")
	req := &lumavaultv1.CommitObjectRequest{
		Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		Filename:       "immutable.jpg",
		SizeBytes:      1024,
		ChunkSizeBytes: 4 << 20,
		Sha256Digest:   testHash("clone-digest"),
		ChunkHashes:    []string{chunk},
	}

	committed, _, err := store.CommitObject(ctx, req)
	if err != nil {
		t.Fatalf("CommitObject: %v", err)
	}

	// Mutate request and returned object slices in caller memory; verify store state is unaffected.
	req.ChunkHashes[0] = "corrupted-in-caller"
	committed.Filename = "corrupted-filename"
	committed.ChunkHashes[0] = "corrupted-in-response"

	fetched, err := store.GetObject(ctx, committed.Id)
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	if fetched.Filename != "immutable.jpg" || fetched.ChunkHashes[0] != chunk {
		t.Fatalf("caller mutation leaked into store state: %+v", fetched)
	}

	// Test Engine.Restore validation and deterministic DeleteObject fallback when two restored objects share (namespace, sha256_digest).
	eng := NewEngine()
	sharedDigest := testHash("dup-photo-digest")
	t1 := timestamppb.New(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	objA := &lumavaultv1.ObjectMetadata{
		Id:             "obj-a",
		Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		SizeBytes:      100,
		ChunkSizeBytes: 4 << 20,
		Sha256Digest:   sharedDigest,
		ChunkHashes:    []string{chunk},
		CreatedAt:      t1,
	}
	objB := &lumavaultv1.ObjectMetadata{
		Id:             "obj-b",
		Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		SizeBytes:      100,
		ChunkSizeBytes: 4 << 20,
		Sha256Digest:   sharedDigest,
		ChunkHashes:    []string{chunk},
		CreatedAt:      t1,
	}
	objC := &lumavaultv1.ObjectMetadata{
		Id:             "obj-c",
		Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		SizeBytes:      100,
		ChunkSizeBytes: 4 << 20,
		Sha256Digest:   sharedDigest,
		ChunkHashes:    []string{chunk},
		CreatedAt:      t1,
	}

	if err := eng.Restore([]*lumavaultv1.ObjectMetadata{objC, objA, objB}); err != nil {
		t.Fatalf("Engine.Restore: %v", err)
	}

	// Failed Restore (duplicate ID) must not wipe existing state in eng.
	if err := eng.Restore([]*lumavaultv1.ObjectMetadata{objA, objA}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("expected ErrInvalidArgument on duplicate ID in Restore, got %v", err)
	}
	if err := eng.Restore([]*lumavaultv1.ObjectMetadata{nil}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("expected ErrInvalidArgument on nil object in Restore, got %v", err)
	}

	// Deleting "obj-a" must deterministically promote "obj-b" (not "obj-c").
	if err := eng.DeleteObject("obj-a"); err != nil {
		t.Fatalf("eng.DeleteObject(obj-a): %v", err)
	}
	dedupObj, dedup, err := eng.CommitObject(&lumavaultv1.CommitObjectRequest{
		Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		SizeBytes:      100,
		ChunkSizeBytes: 4 << 20,
		Sha256Digest:   sharedDigest,
		ChunkHashes:    []string{chunk},
	}, "new-id", time.Now())
	if err != nil || !dedup || dedupObj.Id != "obj-b" {
		t.Fatalf("expected deterministic fallback to 'obj-b', got dedup=%v id=%q err=%v", dedup, dedupObj.Id, err)
	}

	// Verify SkipDedup commits inserted out-of-order maintain oldest-first dedupIndex slice order.
	skipDigest := testHash("skip-dedup-slice-order")
	baseTime := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	skipReq := &lumavaultv1.CommitObjectRequest{
		Namespace:      lumavaultv1.Namespace_NAMESPACE_GAMES,
		SizeBytes:      100,
		ChunkSizeBytes: 4 << 20,
		Sha256Digest:   skipDigest,
		ChunkHashes:    []string{chunk},
		SkipDedup:      true,
	}
	if _, _, err := eng.CommitObject(skipReq, "newer-id", baseTime.Add(10*time.Second)); err != nil {
		t.Fatalf("CommitObject newer-id: %v", err)
	}
	if _, _, err := eng.CommitObject(skipReq, "oldest-id", baseTime); err != nil {
		t.Fatalf("CommitObject oldest-id: %v", err)
	}
	checkReq := &lumavaultv1.CommitObjectRequest{
		Namespace:      lumavaultv1.Namespace_NAMESPACE_GAMES,
		SizeBytes:      100,
		ChunkSizeBytes: 4 << 20,
		Sha256Digest:   skipDigest,
		ChunkHashes:    []string{chunk},
	}
	if got, dedup, err := eng.CommitObject(checkReq, "unused-1", baseTime); err != nil || !dedup || got.Id != "oldest-id" {
		t.Fatalf("expected oldest-id from dedupIndex slice, got dedup=%v id=%q err=%v", dedup, got.Id, err)
	}
	if err := eng.DeleteObject("oldest-id"); err != nil {
		t.Fatalf("DeleteObject oldest-id: %v", err)
	}
	if got, dedup, err := eng.CommitObject(checkReq, "unused-2", baseTime); err != nil || !dedup || got.Id != "newer-id" {
		t.Fatalf("expected newer-id after deleting oldest-id, got dedup=%v id=%q err=%v", dedup, got.Id, err)
	}
}

func TestLocalMetadataStore_DiskErrorsContextAndCleanup(t *testing.T) {
	t.Parallel()

	if _, err := NewLocalMetadataStore(""); err == nil {
		t.Fatalf("expected error for empty rootDir")
	}

	rootDir := t.TempDir()
	tmpDir := filepath.Join(rootDir, "tmp")
	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		t.Fatalf("MkdirAll tmp: %v", err)
	}
	orphanPath := filepath.Join(tmpDir, "meta-orphan")
	if err := os.WriteFile(orphanPath, []byte("orphan"), 0o644); err != nil {
		t.Fatalf("WriteFile orphan: %v", err)
	}

	store, err := NewLocalMetadataStore(rootDir)
	if err != nil {
		t.Fatalf("NewLocalMetadataStore: %v", err)
	}
	if _, err := os.Stat(orphanPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected orphan temp file to be cleaned up on startup, got err=%v", err)
	}

	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, _, err := store.CommitObject(cancelledCtx, &lumavaultv1.CommitObjectRequest{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled on CommitObject, got %v", err)
	}
	if _, err := store.GetObject(cancelledCtx, "id"); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled on GetObject, got %v", err)
	}
	if _, err := store.UpdateObjectMetadata(cancelledCtx, &lumavaultv1.UpdateObjectMetadataRequest{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled on UpdateObjectMetadata, got %v", err)
	}
	if err := store.DeleteObject(cancelledCtx, "id"); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled on DeleteObject, got %v", err)
	}
	if _, err := store.IsChunkReferenced(cancelledCtx, testHash("x")); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled on IsChunkReferenced, got %v", err)
	}

	ctx := context.Background()
	if _, err := store.GetObject(ctx, "../unsafe"); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("expected ErrInvalidArgument on unsafe GetObject ID, got %v", err)
	}
	if err := store.DeleteObject(ctx, "../unsafe"); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("expected ErrInvalidArgument on unsafe DeleteObject ID, got %v", err)
	}
	if err := store.DeleteObject(ctx, "non-existent"); !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("expected ErrObjectNotFound on DeleteObject, got %v", err)
	}
	if _, err := store.IsChunkReferenced(ctx, "bad-hash"); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("expected ErrInvalidArgument on IsChunkReferenced bad hash, got %v", err)
	}

	badObjBytes, err := proto.Marshal(&lumavaultv1.ObjectMetadata{Id: "embedded-id"})
	if err != nil {
		t.Fatalf("proto.Marshal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(rootDir, "objects", "wrong-filename.pb"), badObjBytes, 0o644); err != nil {
		t.Fatalf("WriteFile wrong-filename.pb: %v", err)
	}
	if _, err := NewLocalMetadataStore(rootDir); err == nil {
		t.Fatalf("expected NewLocalMetadataStore to fail when filename does not match embedded object ID")
	}
}

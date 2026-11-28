package chunkstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lumavault/lumavault/core/internal/constants"
	"github.com/lumavault/lumavault/core/internal/validate"
)

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func newTestStore(t *testing.T) *LocalChunkStore {
	t.Helper()
	store, err := NewLocalChunkStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewLocalChunkStore failed: %v", err)
	}
	return store
}

func assertNoTempFiles(t *testing.T, store *LocalChunkStore) {
	t.Helper()
	entries, err := os.ReadDir(store.tmpDir)
	if err != nil {
		t.Fatalf("ReadDir(tmpDir) failed: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected 0 temp files in %s, found %d", store.tmpDir, len(entries))
	}
}

func TestNewLocalChunkStoreValidation(t *testing.T) {
	if _, err := NewLocalChunkStore(""); err == nil {
		t.Fatal("expected error for empty rootDir, got nil")
	}
}

func TestPutAndGetChunkRoundTrip(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	// 100 KiB payload spanning multiple 32 KiB StreamBufferSize reads.
	payload := bytes.Repeat([]byte("lumavault-chunk-data-"), 5000)
	hash := sha256Hex(payload)

	n, err := store.PutChunk(ctx, hash, bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("PutChunk failed: %v", err)
	}
	if n != int64(len(payload)) {
		t.Fatalf("PutChunk wrote %d bytes, want %d", n, len(payload))
	}
	assertNoTempFiles(t, store)

	rc, size, err := store.GetChunk(ctx, hash)
	if err != nil {
		t.Fatalf("GetChunk failed: %v", err)
	}
	defer rc.Close()

	if size != int64(len(payload)) {
		t.Fatalf("GetChunk size = %d, want %d", size, len(payload))
	}
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("ReadAll failed: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatal("GetChunk payload mismatch")
	}
}

func TestZeroByteChunkRoundTripAndRangeRead(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	emptyHash := sha256Hex(nil)
	n, err := store.PutChunk(ctx, emptyHash, bytes.NewReader(nil))
	if err != nil {
		t.Fatalf("PutChunk(empty) failed: %v", err)
	}
	if n != 0 {
		t.Fatalf("PutChunk(empty) wrote %d bytes, want 0", n)
	}

	rc, size, err := store.GetChunk(ctx, emptyHash)
	if err != nil {
		t.Fatalf("GetChunk(empty) failed: %v", err)
	}
	defer rc.Close()
	if size != 0 {
		t.Fatalf("GetChunk(empty) size = %d, want 0", size)
	}

	rangeRC, err := store.ReadChunkRange(ctx, emptyHash, 0, 0)
	if err != nil {
		t.Fatalf("ReadChunkRange(0, 0) on empty chunk failed: %v", err)
	}
	_ = rangeRC.Close()

	if _, err := store.ReadChunkRange(ctx, emptyHash, 0, 1); !errors.Is(err, ErrInvalidRange) {
		t.Fatalf("expected ErrInvalidRange for (0, 1) on empty chunk, got %v", err)
	}
}

func TestPutChunkRejectsHashMismatchAndCleansTempFile(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	payload := []byte("corrupted-network-bytes")
	wrongHash := sha256Hex([]byte("expected-original-bytes"))

	_, err := store.PutChunk(ctx, wrongHash, bytes.NewReader(payload))
	if !errors.Is(err, ErrHashMismatch) {
		t.Fatalf("expected ErrHashMismatch, got %v", err)
	}
	assertNoTempFiles(t, store)

	_, _, err = store.GetChunk(ctx, wrongHash)
	if !errors.Is(err, ErrChunkNotFound) {
		t.Fatalf("expected ErrChunkNotFound after failed PutChunk, got %v", err)
	}
}

type zeroReader struct {
	remaining int64
}

func (z *zeroReader) Read(p []byte) (int, error) {
	if z.remaining <= 0 {
		return 0, io.EOF
	}
	n := int64(len(p))
	if n > z.remaining {
		n = z.remaining
	}
	clear(p[:n])
	z.remaining -= n
	return int(n), nil
}

func TestPutChunkRejectsOversizedPayloadAndCleansTempFile(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	dummyHash := strings.Repeat("a", 64)
	oversized := &zeroReader{remaining: constants.MaxChunkSizeBytes + 1}

	_, err := store.PutChunk(ctx, dummyHash, oversized)
	if !errors.Is(err, ErrChunkTooLarge) {
		t.Fatalf("expected ErrChunkTooLarge, got %v", err)
	}
	assertNoTempFiles(t, store)
}

func TestInvalidHashRejectedAcrossAllMethods(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	invalidHashes := []string{
		"",
		"short",
		strings.Repeat("A", 64), // uppercase hex rejected
		strings.Repeat("g", 64), // non-hex char rejected
		strings.Repeat("a", 63),
		strings.Repeat("a", 65),
	}

	for _, bad := range invalidHashes {
		if _, err := store.PutChunk(ctx, bad, bytes.NewReader(nil)); !errors.Is(err, validate.ErrInvalid) {
			t.Errorf("PutChunk(%q): expected validate.ErrInvalid, got %v", bad, err)
		}
		if _, _, err := store.GetChunk(ctx, bad); !errors.Is(err, validate.ErrInvalid) {
			t.Errorf("GetChunk(%q): expected validate.ErrInvalid, got %v", bad, err)
		}
		if _, err := store.ReadChunkRange(ctx, bad, 0, 1); !errors.Is(err, validate.ErrInvalid) {
			t.Errorf("ReadChunkRange(%q): expected validate.ErrInvalid, got %v", bad, err)
		}
		if _, err := store.HasChunks(ctx, []string{bad}); !errors.Is(err, validate.ErrInvalid) {
			t.Errorf("HasChunks(%q): expected validate.ErrInvalid, got %v", bad, err)
		}
		if _, err := store.StatChunks(ctx, []string{bad}); !errors.Is(err, validate.ErrInvalid) {
			t.Errorf("StatChunks(%q): expected validate.ErrInvalid, got %v", bad, err)
		}
		if err := store.DeleteChunk(ctx, bad); !errors.Is(err, validate.ErrInvalid) {
			t.Errorf("DeleteChunk(%q): expected validate.ErrInvalid, got %v", bad, err)
		}
	}
}

func TestReadChunkRangeBoundariesAndValidation(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	payload := []byte("0123456789abcdefghijklmnopqrstuvwxyz")
	hash := sha256Hex(payload)
	if _, err := store.PutChunk(ctx, hash, bytes.NewReader(payload)); err != nil {
		t.Fatalf("PutChunk failed: %v", err)
	}

	cases := []struct {
		name   string
		offset int64
		length int64
		want   string
	}{
		{name: "start", offset: 0, length: 10, want: "0123456789"},
		{name: "middle", offset: 10, length: 13, want: "abcdefghijklm"},
		{name: "tail", offset: 23, length: 13, want: "nopqrstuvwxyz"},
		{name: "empty_at_end", offset: int64(len(payload)), length: 0, want: ""},
		{name: "full", offset: 0, length: int64(len(payload)), want: string(payload)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rc, err := store.ReadChunkRange(ctx, hash, tc.offset, tc.length)
			if err != nil {
				t.Fatalf("ReadChunkRange(%d, %d) failed: %v", tc.offset, tc.length, err)
			}
			defer rc.Close()

			got, err := io.ReadAll(rc)
			if err != nil {
				t.Fatalf("ReadAll failed: %v", err)
			}
			if string(got) != tc.want {
				t.Fatalf("ReadChunkRange(%d, %d) = %q, want %q", tc.offset, tc.length, string(got), tc.want)
			}
		})
	}

	invalidRanges := [][2]int64{
		{-1, 5},
		{0, -1},
		{int64(len(payload)) + 1, 0},
		{10, int64(len(payload)) - 9},
		{1, math.MaxInt64}, // overflow check on offset + length
	}
	for _, rng := range invalidRanges {
		if _, err := store.ReadChunkRange(ctx, hash, rng[0], rng[1]); !errors.Is(err, ErrInvalidRange) {
			t.Errorf("ReadChunkRange(%d, %d): expected ErrInvalidRange, got %v", rng[0], rng[1], err)
		}
	}

	missingHash := sha256Hex([]byte("missing-chunk"))
	if _, err := store.ReadChunkRange(ctx, missingHash, 0, 1); !errors.Is(err, ErrChunkNotFound) {
		t.Errorf("expected ErrChunkNotFound for missing chunk, got %v", err)
	}
}

func TestHasChunksOrderDeduplicationAndLeaseRenewal(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	// Empty input returns nil/empty without error.
	if empty, err := store.HasChunks(ctx, nil); err != nil || len(empty) != 0 {
		t.Fatalf("HasChunks(nil) = %v, %v; want empty, nil", empty, err)
	}

	chunkA := []byte("chunk-a-bytes")
	hashA := sha256Hex(chunkA)
	chunkB := []byte("chunk-b-bytes")
	hashB := sha256Hex(chunkB)
	hashC := sha256Hex([]byte("chunk-c-missing"))

	if _, err := store.PutChunk(ctx, hashA, bytes.NewReader(chunkA)); err != nil {
		t.Fatalf("PutChunk(A) failed: %v", err)
	}

	// Backdate chunk A to 30 hours ago (older than a 24h GC grace period).
	oldTime := time.Now().Add(-30 * time.Hour)
	pathA := store.chunkPath(hashA)
	if err := os.Chtimes(pathA, oldTime, oldTime); err != nil {
		t.Fatalf("Chtimes(A) failed: %v", err)
	}

	// Probe [hashC, hashA, hashB, hashC, hashA] -> missing should be [hashC, hashB] in order,
	// and hashA's mtime should be refreshed to ~now so a 24h GC run does NOT delete hashA!
	missing, err := store.HasChunks(ctx, []string{hashC, hashA, hashB, hashC, hashA})
	if err != nil {
		t.Fatalf("HasChunks failed: %v", err)
	}
	wantMissing := []string{hashC, hashB}
	if !reflect.DeepEqual(missing, wantMissing) {
		t.Fatalf("HasChunks missing = %v, want %v", missing, wantMissing)
	}

	infoA, err := os.Stat(pathA)
	if err != nil {
		t.Fatalf("Stat(A) failed: %v", err)
	}
	if time.Since(infoA.ModTime()) > time.Minute {
		t.Fatalf("expected HasChunks to refresh chunk A mtime to now, got ModTime=%v", infoA.ModTime())
	}

	// Verify GarbageCollect(24h) preserves unreferenced chunk A because HasChunks renewed its lease.
	deleted, err := store.GarbageCollect(ctx, func(string) (bool, error) {
		return false, nil
	}, 24*time.Hour)
	if err != nil {
		t.Fatalf("GarbageCollect failed: %v", err)
	}
	if deleted != 0 {
		t.Fatalf("expected 0 chunks deleted after HasChunks lease renewal, got %d", deleted)
	}
}

func TestPutChunkRenewsLeaseOnExistingChunk(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	chunk := []byte("dedup-put-chunk")
	hash := sha256Hex(chunk)
	if _, err := store.PutChunk(ctx, hash, bytes.NewReader(chunk)); err != nil {
		t.Fatalf("first PutChunk failed: %v", err)
	}

	oldTime := time.Now().Add(-48 * time.Hour)
	path := store.chunkPath(hash)
	if err := os.Chtimes(path, oldTime, oldTime); err != nil {
		t.Fatalf("Chtimes failed: %v", err)
	}

	// Re-upload the same chunk; mtime must be refreshed to now.
	if _, err := store.PutChunk(ctx, hash, bytes.NewReader(chunk)); err != nil {
		t.Fatalf("second PutChunk failed: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat failed: %v", err)
	}
	if time.Since(info.ModTime()) > time.Minute {
		t.Fatalf("expected second PutChunk to refresh mtime, got %v", info.ModTime())
	}
}

func TestStatChunksAndDeleteChunk(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	if empty, err := store.StatChunks(ctx, nil); err != nil || len(empty) != 0 {
		t.Fatalf("StatChunks(nil) = %v, %v; want empty, nil", empty, err)
	}

	chunk1 := []byte("first-chunk")
	hash1 := sha256Hex(chunk1)
	chunk2 := []byte("second-longer-chunk-payload")
	hash2 := sha256Hex(chunk2)

	if _, err := store.PutChunk(ctx, hash1, bytes.NewReader(chunk1)); err != nil {
		t.Fatalf("PutChunk(1) failed: %v", err)
	}
	if _, err := store.PutChunk(ctx, hash2, bytes.NewReader(chunk2)); err != nil {
		t.Fatalf("PutChunk(2) failed: %v", err)
	}

	sizes, err := store.StatChunks(ctx, []string{hash1, hash2, hash1})
	if err != nil {
		t.Fatalf("StatChunks failed: %v", err)
	}
	if sizes[hash1] != int64(len(chunk1)) || sizes[hash2] != int64(len(chunk2)) {
		t.Fatalf("unexpected StatChunks sizes: %v", sizes)
	}

	// Delete chunk1 (and verify idempotency on second DeleteChunk call).
	if err := store.DeleteChunk(ctx, hash1); err != nil {
		t.Fatalf("DeleteChunk(1) failed: %v", err)
	}
	if err := store.DeleteChunk(ctx, hash1); err != nil {
		t.Fatalf("idempotent DeleteChunk(1) failed: %v", err)
	}

	if _, err := store.StatChunks(ctx, []string{hash1, hash2}); !errors.Is(err, ErrChunkNotFound) {
		t.Fatalf("expected ErrChunkNotFound from StatChunks when hash1 is deleted, got %v", err)
	}
}

func TestGarbageCollectPredicateGracePeriodAndErrorPropagation(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	// 1. Referenced old chunk -> must be kept.
	refOld := []byte("referenced-old-chunk")
	hashRefOld := sha256Hex(refOld)
	// 2. Unreferenced old chunk -> must be deleted.
	unrefOld := []byte("unreferenced-old-chunk")
	hashUnrefOld := sha256Hex(unrefOld)
	// 3. Unreferenced fresh chunk (< 24h) -> must be kept without even querying isReferenced.
	unrefFresh := []byte("unreferenced-fresh-chunk")
	hashUnrefFresh := sha256Hex(unrefFresh)

	for _, item := range []struct {
		hash string
		data []byte
	}{
		{hashRefOld, refOld},
		{hashUnrefOld, unrefOld},
		{hashUnrefFresh, unrefFresh},
	} {
		if _, err := store.PutChunk(ctx, item.hash, bytes.NewReader(item.data)); err != nil {
			t.Fatalf("PutChunk(%s) failed: %v", item.hash, err)
		}
	}

	expiredTime := time.Now().Add(-25 * time.Hour)
	for _, h := range []string{hashRefOld, hashUnrefOld} {
		if err := os.Chtimes(store.chunkPath(h), expiredTime, expiredTime); err != nil {
			t.Fatalf("Chtimes(%s) failed: %v", h, err)
		}
	}

	// Plant a non-hash file in chunksDir to ensure GC ignores non-chunk files safely.
	nonHashFile := filepath.Join(store.chunksDir, "ignore-me.txt")
	if err := os.WriteFile(nonHashFile, []byte("metadata"), 0o644); err != nil {
		t.Fatalf("WriteFile(nonHashFile) failed: %v", err)
	}
	if err := os.Chtimes(nonHashFile, expiredTime, expiredTime); err != nil {
		t.Fatalf("Chtimes(nonHashFile) failed: %v", err)
	}

	// Also plant a stale temporary file (> 24h) and a fresh temporary file (< 24h) in tmpDir.
	staleTmp := filepath.Join(store.tmpDir, "stale.tmp")
	freshTmp := filepath.Join(store.tmpDir, "fresh.tmp")
	if err := os.WriteFile(staleTmp, []byte("partial"), 0o644); err != nil {
		t.Fatalf("WriteFile(staleTmp) failed: %v", err)
	}
	if err := os.Chtimes(staleTmp, expiredTime, expiredTime); err != nil {
		t.Fatalf("Chtimes(staleTmp) failed: %v", err)
	}
	if err := os.WriteFile(freshTmp, []byte("active"), 0o644); err != nil {
		t.Fatalf("WriteFile(freshTmp) failed: %v", err)
	}

	// Verify that an error from isReferenced aborts GC and surfaces the error.
	sentinelErr := errors.New("metadata store unavailable")
	if _, err := store.GarbageCollect(ctx, func(string) (bool, error) {
		return false, sentinelErr
	}, 24*time.Hour); !errors.Is(err, sentinelErr) {
		t.Fatalf("expected GarbageCollect to propagate sentinelErr, got %v", err)
	}

	var queriedHashes []string
	deleted, err := store.GarbageCollect(ctx, func(hash string) (bool, error) {
		queriedHashes = append(queriedHashes, hash)
		return hash == hashRefOld, nil
	}, 24*time.Hour)
	if err != nil {
		t.Fatalf("GarbageCollect failed: %v", err)
	}

	// Should delete hashUnrefOld (1) + staleTmp (1) = 2 files total.
	if deleted != 2 {
		t.Fatalf("GarbageCollect deleted = %d, want 2", deleted)
	}

	// Ensure hashUnrefFresh was never even passed to isReferenced since its mtime was < 24h.
	for _, q := range queriedHashes {
		if q == hashUnrefFresh {
			t.Fatal("GarbageCollect queried isReferenced for a chunk newer than gracePeriod")
		}
	}

	// Verify remaining chunks and temp files.
	missing, err := store.HasChunks(ctx, []string{hashRefOld, hashUnrefOld, hashUnrefFresh})
	if err != nil {
		t.Fatalf("HasChunks failed: %v", err)
	}
	if !reflect.DeepEqual(missing, []string{hashUnrefOld}) {
		t.Fatalf("expected only hashUnrefOld to be missing after GC, got %v", missing)
	}
	if _, err := os.Stat(staleTmp); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected staleTmp to be removed, got err=%v", err)
	}
	if _, err := os.Stat(freshTmp); err != nil {
		t.Fatalf("expected freshTmp to be preserved, got err=%v", err)
	}
}

type cancelAfterFirstReadReader struct {
	cancel context.CancelFunc
	calls  int
}

func (r *cancelAfterFirstReadReader) Read(p []byte) (int, error) {
	r.calls++
	if r.calls == 1 {
		copy(p, []byte("first-buffer-chunk"))
		r.cancel()
		return 18, nil
	}
	return 0, io.EOF
}

func TestMidStreamCancellationAndContextArgs(t *testing.T) {
	store := newTestStore(t)
	validHash := sha256Hex([]byte("test"))

	// Mid-stream cancellation during PutChunk must abort and clean up the temporary file.
	midCtx, midCancel := context.WithCancel(context.Background())
	reader := &cancelAfterFirstReadReader{cancel: midCancel}
	if _, err := store.PutChunk(midCtx, validHash, reader); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled on mid-stream abort, got %v", err)
	}
	assertNoTempFiles(t, store)

	if _, err := store.PutChunk(context.Background(), validHash, nil); err == nil {
		t.Fatal("expected error for nil reader in PutChunk")
	}
	if _, err := store.GarbageCollect(context.Background(), nil, time.Hour); err == nil {
		t.Fatal("expected error for nil isReferenced predicate")
	}
	if _, err := store.GarbageCollect(context.Background(), func(string) (bool, error) { return false, nil }, -time.Second); err == nil {
		t.Fatal("expected error for negative gracePeriod")
	}

	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := store.PutChunk(canceledCtx, validHash, bytes.NewReader([]byte("test"))); !errors.Is(err, context.Canceled) {
		t.Errorf("PutChunk with canceled ctx: got %v, want context.Canceled", err)
	}
	if _, _, err := store.GetChunk(canceledCtx, validHash); !errors.Is(err, context.Canceled) {
		t.Errorf("GetChunk with canceled ctx: got %v, want context.Canceled", err)
	}
	if _, err := store.ReadChunkRange(canceledCtx, validHash, 0, 1); !errors.Is(err, context.Canceled) {
		t.Errorf("ReadChunkRange with canceled ctx: got %v, want context.Canceled", err)
	}
	if _, err := store.HasChunks(canceledCtx, []string{validHash}); !errors.Is(err, context.Canceled) {
		t.Errorf("HasChunks with canceled ctx: got %v, want context.Canceled", err)
	}
	if _, err := store.StatChunks(canceledCtx, []string{validHash}); !errors.Is(err, context.Canceled) {
		t.Errorf("StatChunks with canceled ctx: got %v, want context.Canceled", err)
	}
	if err := store.DeleteChunk(canceledCtx, validHash); !errors.Is(err, context.Canceled) {
		t.Errorf("DeleteChunk with canceled ctx: got %v, want context.Canceled", err)
	}
	if _, err := store.GarbageCollect(canceledCtx, func(string) (bool, error) { return false, nil }, time.Hour); !errors.Is(err, context.Canceled) {
		t.Errorf("GarbageCollect with canceled ctx: got %v, want context.Canceled", err)
	}
}

func TestConcurrentMixedWorkloadAndGCLeaseRace(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	payload := bytes.Repeat([]byte("concurrent-dedup-block-"), 4096)
	hash := sha256Hex(payload)

	// Pre-populate and backdate the chunk, then race GarbageCollect against HasChunks,
	// PutChunk, GetChunk, and ReadChunkRange concurrently.
	if _, err := store.PutChunk(ctx, hash, bytes.NewReader(payload)); err != nil {
		t.Fatalf("initial PutChunk failed: %v", err)
	}
	oldTime := time.Now().Add(-30 * time.Hour)
	if err := os.Chtimes(store.chunkPath(hash), oldTime, oldTime); err != nil {
		t.Fatalf("Chtimes failed: %v", err)
	}

	// Simulate HasChunks renewing the lease right when GarbageCollect's isReferenced callback runs!
	deleted, err := store.GarbageCollect(ctx, func(h string) (bool, error) {
		// While GC is inspecting this old chunk, a concurrent client calls HasChunks
		// to deduplicate and renew the lease.
		missing, hErr := store.HasChunks(ctx, []string{h})
		if hErr != nil {
			return false, hErr
		}
		if len(missing) != 0 {
			return false, errors.New("expected chunk to be present during HasChunks")
		}
		return false, nil
	}, 24*time.Hour)
	if err != nil {
		t.Fatalf("GarbageCollect failed: %v", err)
	}
	if deleted != 0 {
		t.Fatalf("GarbageCollect deleted chunk whose lease was renewed mid-GC!")
	}

	const workers = 16
	var wg sync.WaitGroup
	errCh := make(chan error, workers*3)

	for i := 0; i < workers; i++ {
		wg.Add(3)
		go func() {
			defer wg.Done()
			n, err := store.PutChunk(ctx, hash, bytes.NewReader(payload))
			if err != nil {
				errCh <- err
				return
			}
			if n != int64(len(payload)) {
				errCh <- errors.New("short write in concurrent PutChunk")
			}
		}()
		go func() {
			defer wg.Done()
			if _, err := store.HasChunks(ctx, []string{hash}); err != nil {
				errCh <- err
			}
		}()
		go func() {
			defer wg.Done()
			rc, err := store.ReadChunkRange(ctx, hash, 0, 23)
			if err != nil {
				errCh <- err
				return
			}
			_ = rc.Close()
		}()
	}
	wg.Wait()
	close(errCh)

	for err := range errCh {
		t.Fatalf("concurrent operation failed: %v", err)
	}
	assertNoTempFiles(t, store)

	rc, size, err := store.GetChunk(ctx, hash)
	if err != nil {
		t.Fatalf("GetChunk after concurrent uploads failed: %v", err)
	}
	defer rc.Close()

	if size != int64(len(payload)) {
		t.Fatalf("GetChunk size = %d, want %d", size, len(payload))
	}
}

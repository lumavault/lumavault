package gateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
	"github.com/lumavault/lumavault/core/gen/go/lumavault/v1/lumavaultv1connect"
	"github.com/lumavault/lumavault/core/internal/chunkstore"
	"github.com/lumavault/lumavault/core/internal/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// countingChunks wraps a real ChunkStore and counts the calls that touch chunk data.
type countingChunks struct {
	chunkstore.ChunkStore
	gets, ranges, stats atomic.Int64
}

func (c *countingChunks) GetChunk(ctx context.Context, hash string) (io.ReadCloser, int64, error) {
	c.gets.Add(1)
	return c.ChunkStore.GetChunk(ctx, hash)
}

func (c *countingChunks) ReadChunkRange(ctx context.Context, hash string, off, n int64) (io.ReadCloser, error) {
	c.ranges.Add(1)
	return c.ChunkStore.ReadChunkRange(ctx, hash, off, n)
}

func (c *countingChunks) StatChunks(ctx context.Context, hashes []string) (map[string]int64, error) {
	c.stats.Add(1)
	return c.ChunkStore.StatChunks(ctx, hashes)
}

func (c *countingChunks) reset() {
	c.gets.Store(0)
	c.ranges.Store(0)
	c.stats.Store(0)
}

type harness struct {
	t         *testing.T
	srv       *httptest.Server
	client    lumavaultv1connect.StorageServiceClient
	chunks    *countingChunks
	chunkRoot string
}

// newHarness starts a gateway over fresh stores with ticket checks off. Any seed manifests
// are written to disk before the metadata store opens, as if a previous run had stored them.
func newHarness(t *testing.T, seed ...*lumavaultv1.ObjectMetadata) *harness {
	t.Helper()
	return newHarnessWith(t, nil, seed...)
}

// newHarnessWith is newHarness with handler options, such as ticket checks.
func newHarnessWith(t *testing.T, opts []Option, seed ...*lumavaultv1.ObjectMetadata) *harness {
	t.Helper()
	root := t.TempDir()
	chunkRoot := filepath.Join(root, "chunks")
	cs, err := chunkstore.NewLocalChunkStore(chunkRoot)
	if err != nil {
		t.Fatal(err)
	}
	metaRoot := filepath.Join(root, "meta")
	seedObjects(t, filepath.Join(metaRoot, "objects"), seed)
	ms, err := metadata.NewLocalMetadataStore(metaRoot)
	if err != nil {
		t.Fatal(err)
	}
	counting := &countingChunks{ChunkStore: cs}
	srv := httptest.NewServer(NewHandler(ms, counting, opts...))
	t.Cleanup(srv.Close)
	client := lumavaultv1connect.NewStorageServiceClient(
		connect.NewClient(connecthttp.NewTransport(srv.Client(), srv.URL)))
	return &harness{t: t, srv: srv, client: client, chunks: counting, chunkRoot: chunkRoot}
}

func seedObjects(t *testing.T, dir string, objs []*lumavaultv1.ObjectMetadata) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, obj := range objs {
		raw, err := proto.Marshal(obj)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, obj.GetId()+".pb"), raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// legacyEmptyObject is a 0-byte manifest of the kind stored before CommitObject rejected them.
func legacyEmptyObject() *lumavaultv1.ObjectMetadata {
	return &lumavaultv1.ObjectMetadata{
		Id:           "00000000-0000-4000-8000-000000000000",
		Namespace:    lumavaultv1.Namespace_NAMESPACE_CINEMA,
		Filename:     "empty.mp4",
		MimeType:     "video/mp4",
		Sha256Digest: sha(nil),
		CreatedAt:    timestamppb.Now(),
		UpdatedAt:    timestamppb.Now(),
	}
}

func sha(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// pattern returns n deterministic bytes where byte i is i mod 251, so any offset is checkable.
func pattern(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i % 251)
	}
	return b
}

func (h *harness) do(method, path string, body io.Reader, header map[string]string) (*http.Response, []byte) {
	h.t.Helper()
	req, err := http.NewRequest(method, h.srv.URL+path, body)
	if err != nil {
		h.t.Fatal(err)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := h.srv.Client().Do(req)
	if err != nil {
		h.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		h.t.Fatalf("%s %s: read body: %v", method, path, err)
	}
	return res, data
}

func (h *harness) putChunk(data []byte) {
	h.t.Helper()
	res, body := h.do(http.MethodPut, "/v1/chunks/"+sha(data), bytes.NewReader(data), nil)
	if res.StatusCode != http.StatusCreated {
		h.t.Fatalf("PUT chunk: status %d body %s", res.StatusCode, body)
	}
}

// split cuts data into chunkSize pieces and returns the pieces and their hashes.
func split(data []byte, chunkSize int) ([][]byte, []string) {
	var parts [][]byte
	var hashes []string
	for off := 0; off < len(data); off += chunkSize {
		p := data[off:min(off+chunkSize, len(data))]
		parts = append(parts, p)
		hashes = append(hashes, sha(p))
	}
	return parts, hashes
}

func commitReq(data []byte, chunkSize int, hashes []string) *lumavaultv1.CommitObjectRequest {
	return &lumavaultv1.CommitObjectRequest{
		Namespace:      lumavaultv1.Namespace_NAMESPACE_CINEMA,
		Filename:       "clip.mp4",
		MimeType:       "video/mp4",
		SizeBytes:      uint64(len(data)),
		ChunkSizeBytes: uint32(chunkSize),
		Sha256Digest:   sha(data),
		ChunkHashes:    hashes,
	}
}

// upload puts every chunk of data and commits it.
func (h *harness) upload(data []byte, chunkSize int) *lumavaultv1.ObjectMetadata {
	h.t.Helper()
	parts, hashes := split(data, chunkSize)
	for _, p := range parts {
		h.putChunk(p)
	}
	res, err := h.client.CommitObject(context.Background(), commitReq(data, chunkSize, hashes))
	if err != nil {
		h.t.Fatalf("CommitObject: %v", err)
	}
	return res.GetObject()
}

func wantCode(t *testing.T, err error, code connect.Code) {
	t.Helper()
	if got := connect.CodeOf(err); got != code {
		t.Fatalf("got code %v (err %v), want %v", got, err, code)
	}
}

func TestHealthz(t *testing.T) {
	h := newHarness(t)
	res, body := h.do(http.MethodGet, "/healthz", nil, nil)
	if res.StatusCode != http.StatusOK || string(bytes.TrimSpace(body)) != `{"status":"ok"}` {
		t.Fatalf("healthz: %d %s", res.StatusCode, body)
	}
}

func TestUploadLifecycle(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	data := pattern(2500)
	parts, hashes := split(data, 1000)

	has, err := h.client.HasChunks(ctx, &lumavaultv1.HasChunksRequest{ChunkHashes: hashes})
	if err != nil {
		t.Fatal(err)
	}
	if len(has.GetMissingChunkHashes()) != 3 {
		t.Fatalf("missing = %v, want all 3", has.GetMissingChunkHashes())
	}
	for _, p := range parts {
		h.putChunk(p)
	}
	has, err = h.client.HasChunks(ctx, &lumavaultv1.HasChunksRequest{ChunkHashes: hashes})
	if err != nil || len(has.GetMissingChunkHashes()) != 0 {
		t.Fatalf("after upload missing = %v, err %v", has.GetMissingChunkHashes(), err)
	}

	committed, err := h.client.CommitObject(ctx, commitReq(data, 1000, hashes))
	if err != nil || committed.GetDeduplicated() {
		t.Fatalf("first commit: %v dedup=%v", err, committed.GetDeduplicated())
	}
	obj := committed.GetObject()
	again, err := h.client.CommitObject(ctx, commitReq(data, 1000, hashes))
	if err != nil || !again.GetDeduplicated() || again.GetObject().GetId() != obj.GetId() {
		t.Fatalf("second commit should dedup to %s: %v %v", obj.GetId(), again, err)
	}

	got, err := h.client.GetObject(ctx, &lumavaultv1.GetObjectRequest{ObjectId: obj.GetId()})
	if err != nil || got.GetObject().GetSha256Digest() != sha(data) {
		t.Fatalf("GetObject: %v %v", got, err)
	}
	list, err := h.client.ListObjects(ctx, &lumavaultv1.ListObjectsRequest{Namespace: lumavaultv1.Namespace_NAMESPACE_CINEMA})
	if err != nil || len(list.GetObjects()) != 1 {
		t.Fatalf("ListObjects: %v %v", list, err)
	}

	thumb := []byte("thumbnail")
	h.putChunk(thumb)
	upd, err := h.client.UpdateObjectMetadata(ctx, &lumavaultv1.UpdateObjectMetadataRequest{
		Object:     &lumavaultv1.ObjectMetadata{Id: obj.GetId(), Filename: "renamed.mp4", ThumbnailChunkHash: sha(thumb)},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"filename", "thumbnail_chunk_hash"}},
	})
	if err != nil || upd.GetObject().GetFilename() != "renamed.mp4" || upd.GetObject().GetThumbnailChunkHash() != sha(thumb) {
		t.Fatalf("UpdateObjectMetadata: %v %v", upd, err)
	}

	if _, err := h.client.DeleteObject(ctx, &lumavaultv1.DeleteObjectRequest{ObjectId: obj.GetId()}); err != nil {
		t.Fatal(err)
	}
	_, err = h.client.GetObject(ctx, &lumavaultv1.GetObjectRequest{ObjectId: obj.GetId()})
	wantCode(t, err, connect.CodeNotFound)
}

func TestGRPCWebProtocol(t *testing.T) {
	h := newHarness(t)
	client := lumavaultv1connect.NewStorageServiceClient(
		connect.NewClient(connecthttp.NewTransport(h.srv.Client(), h.srv.URL, connecthttp.WithGRPCWeb())))
	res, err := client.HasChunks(context.Background(), &lumavaultv1.HasChunksRequest{ChunkHashes: []string{sha([]byte("x"))}})
	if err != nil || len(res.GetMissingChunkHashes()) != 1 {
		t.Fatalf("gRPC-Web HasChunks: %v %v", res, err)
	}
}

// tmpFiles lists staging files left in the chunk store's tmp directory.
func (h *harness) tmpFiles() []os.DirEntry {
	h.t.Helper()
	entries, err := os.ReadDir(filepath.Join(h.chunkRoot, "tmp"))
	if err != nil {
		h.t.Fatal(err)
	}
	return entries
}

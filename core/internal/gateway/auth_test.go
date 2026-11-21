package gateway

import (
	"bytes"
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
	"github.com/lumavault/lumavault/core/internal/ticket"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

const (
	testTicketSecret = "gateway-test-ticket-secret-0123456789abcdef"
	testServiceKey   = "gateway-test-service-key"
)

func newAuthHarness(t *testing.T) *harness {
	t.Helper()
	v, err := ticket.NewVerifier([]byte(testTicketSecret))
	if err != nil {
		t.Fatal(err)
	}
	return newHarnessWith(t, []Option{WithTicketAuth(v, testServiceKey)})
}

func mint(t *testing.T, c ticket.Claims) string {
	t.Helper()
	if c.Exp == 0 {
		c.Exp = time.Now().Add(time.Hour).Unix()
	}
	tok, err := ticket.Sign([]byte(testTicketSecret), c)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func uploadTicket(t *testing.T, ns lumavaultv1.Namespace, max uint64) string {
	return mint(t, ticket.Claims{Kind: ticket.KindUpload, Namespace: int32(ns), MaxSizeBytes: max})
}

// as returns a context whose RPCs carry the given header.
func as(key, value string) context.Context {
	ctx, info := connect.NewClientContext(context.Background())
	if key != "" {
		info.RequestHeader().Set(key, value)
	}
	return ctx
}

func bearer(token string) context.Context { return as(headerAuthorization, "Bearer "+token) }

func service() context.Context { return as(headerServiceKey, testServiceKey) }

// seed uploads one object with the service key and returns it, so read tests have a target.
func (h *harness) seed() (*lumavaultv1.ObjectMetadata, *lumavaultv1.CommitObjectRequest) {
	h.t.Helper()
	data := pattern(1000)
	parts, hashes := split(data, 1000)
	for _, p := range parts {
		h.do("PUT", "/v1/chunks/"+sha(p), bytesReader(p), map[string]string{headerServiceKey: testServiceKey})
	}
	req := commitReq(data, 1000, hashes)
	req.SkipDedup = true
	res, err := h.client.CommitObject(service(), req)
	if err != nil {
		h.t.Fatalf("seed commit: %v", err)
	}
	return res.GetObject(), req
}

type call struct {
	name string
	run  func(ctx context.Context) error
}

func (h *harness) calls(obj *lumavaultv1.ObjectMetadata, commit *lumavaultv1.CommitObjectRequest) []call {
	return []call{
		{"HasChunks", func(ctx context.Context) error {
			_, err := h.client.HasChunks(ctx, &lumavaultv1.HasChunksRequest{ChunkHashes: obj.GetChunkHashes()})
			return err
		}},
		{"CommitObject", func(ctx context.Context) error {
			_, err := h.client.CommitObject(ctx, commit)
			return err
		}},
		{"GetObject", func(ctx context.Context) error {
			_, err := h.client.GetObject(ctx, &lumavaultv1.GetObjectRequest{ObjectId: obj.GetId()})
			return err
		}},
		{"ListObjects", func(ctx context.Context) error {
			_, err := h.client.ListObjects(ctx, &lumavaultv1.ListObjectsRequest{Namespace: obj.GetNamespace()})
			return err
		}},
		{"UpdateObjectMetadata", func(ctx context.Context) error {
			_, err := h.client.UpdateObjectMetadata(ctx, &lumavaultv1.UpdateObjectMetadataRequest{
				Object:     &lumavaultv1.ObjectMetadata{Id: obj.GetId(), Filename: "renamed.mp4"},
				UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"filename"}},
			})
			return err
		}},
		{"DeleteObject", func(ctx context.Context) error {
			_, err := h.client.DeleteObject(ctx, &lumavaultv1.DeleteObjectRequest{ObjectId: "missing-object"})
			return err
		}},
	}
}

func codeOf(err error) string {
	if err == nil {
		return "ok"
	}
	return connect.CodeOf(err).String()
}

// The credential table from the storage tickets scoping doc, one row per credential.
func TestRPCCredentialTable(t *testing.T) {
	h := newAuthHarness(t)
	obj, commit := h.seed()
	otherObj := mint(t, ticket.Claims{Kind: ticket.KindRead, ObjectID: "someone-else"})

	rows := []struct {
		name string
		ctx  context.Context
		want map[string]string
	}{
		{"no credential", context.Background(), map[string]string{
			"HasChunks": "unauthenticated", "CommitObject": "unauthenticated", "GetObject": "unauthenticated",
			"ListObjects": "unauthenticated", "UpdateObjectMetadata": "unauthenticated", "DeleteObject": "unauthenticated",
		}},
		{"wrong service key", as(headerServiceKey, "nope"), map[string]string{
			"HasChunks": "unauthenticated", "CommitObject": "unauthenticated", "GetObject": "unauthenticated",
			"ListObjects": "unauthenticated", "UpdateObjectMetadata": "unauthenticated", "DeleteObject": "unauthenticated",
		}},
		{"service key", service(), map[string]string{
			"HasChunks": "ok", "CommitObject": "ok", "GetObject": "ok",
			"ListObjects": "ok", "UpdateObjectMetadata": "ok", "DeleteObject": "not_found",
		}},
		{"upload ticket", bearer(uploadTicket(t, commit.GetNamespace(), commit.GetSizeBytes())), map[string]string{
			"HasChunks": "ok", "CommitObject": "ok", "GetObject": "permission_denied",
			"ListObjects": "permission_denied", "UpdateObjectMetadata": "permission_denied", "DeleteObject": "permission_denied",
		}},
		{"read ticket for the object", bearer(mint(t, ticket.Claims{Kind: ticket.KindRead, ObjectID: obj.GetId()})), map[string]string{
			"HasChunks": "permission_denied", "CommitObject": "permission_denied", "GetObject": "ok",
			"ListObjects": "permission_denied", "UpdateObjectMetadata": "permission_denied", "DeleteObject": "permission_denied",
		}},
		{"read ticket for another object", bearer(otherObj), map[string]string{
			"HasChunks": "permission_denied", "CommitObject": "permission_denied", "GetObject": "permission_denied",
			"ListObjects": "permission_denied", "UpdateObjectMetadata": "permission_denied", "DeleteObject": "permission_denied",
		}},
		{"thumbnail read ticket", bearer(mint(t, ticket.Claims{Kind: ticket.KindRead, ChunkSHA256: obj.GetChunkHashes()[0]})), map[string]string{
			"HasChunks": "permission_denied", "CommitObject": "permission_denied", "GetObject": "permission_denied",
			"ListObjects": "permission_denied", "UpdateObjectMetadata": "permission_denied", "DeleteObject": "permission_denied",
		}},
		{"expired ticket", bearer(mint(t, ticket.Claims{Kind: ticket.KindRead, ObjectID: obj.GetId(), Exp: time.Now().Add(-time.Hour).Unix()})), map[string]string{
			"HasChunks": "unauthenticated", "CommitObject": "unauthenticated", "GetObject": "unauthenticated",
			"ListObjects": "unauthenticated", "UpdateObjectMetadata": "unauthenticated", "DeleteObject": "unauthenticated",
		}},
	}
	for _, row := range rows {
		for _, c := range h.calls(obj, commit) {
			if got := codeOf(c.run(row.ctx)); got != row.want[c.name] {
				t.Errorf("%s / %s: got %s, want %s", row.name, c.name, got, row.want[c.name])
			}
		}
	}
}

func TestUploadTicketCommitLimits(t *testing.T) {
	h := newAuthHarness(t)
	_, commit := h.seed()
	size := commit.GetSizeBytes()

	wrongNamespace := uploadTicket(t, lumavaultv1.Namespace_NAMESPACE_PHOTOS, size)
	if got := codeOf(callCommit(h, bearer(wrongNamespace), commit)); got != "permission_denied" {
		t.Errorf("wrong namespace: %s", got)
	}
	tooSmall := uploadTicket(t, commit.GetNamespace(), size-1)
	if got := codeOf(callCommit(h, bearer(tooSmall), commit)); got != "permission_denied" {
		t.Errorf("size over max: %s", got)
	}
	noSkip := cloneCommit(commit)
	noSkip.SkipDedup = false
	if got := codeOf(callCommit(h, bearer(uploadTicket(t, commit.GetNamespace(), size)), noSkip)); got != "permission_denied" {
		t.Errorf("skip_dedup false: %s", got)
	}
	if got := codeOf(callCommit(h, bearer(uploadTicket(t, commit.GetNamespace(), size)), commit)); got != "ok" {
		t.Errorf("exact limits: %s", got)
	}
}

func TestChecksOffAllowsEverything(t *testing.T) {
	h := newHarness(t)
	data := pattern(10)
	h.putChunk(data)
	req := commitReq(data, 10, []string{sha(data)})
	if _, err := h.client.CommitObject(context.Background(), req); err != nil {
		t.Fatalf("commit without credentials: %v", err)
	}
	if _, err := h.client.ListObjects(context.Background(), &lumavaultv1.ListObjectsRequest{Namespace: req.GetNamespace()}); err != nil {
		t.Fatalf("list without credentials: %v", err)
	}
}

func callCommit(h *harness, ctx context.Context, req *lumavaultv1.CommitObjectRequest) error {
	_, err := h.client.CommitObject(ctx, req)
	return err
}

func cloneCommit(req *lumavaultv1.CommitObjectRequest) *lumavaultv1.CommitObjectRequest {
	return proto.Clone(req).(*lumavaultv1.CommitObjectRequest)
}

func bytesReader(b []byte) *bytes.Reader { return bytes.NewReader(b) }

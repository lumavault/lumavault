package gateway

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/lumavault/lumavault/core/internal/ticket"
)

func TestDataPlaneTickets(t *testing.T) {
	h := newAuthHarness(t)
	obj, _ := h.seed()
	chunk := obj.GetChunkHashes()[0]
	readObj := mint(t, ticket.Claims{Kind: ticket.KindRead, ObjectID: obj.GetId()})
	upload := mint(t, ticket.Claims{Kind: ticket.KindUpload, Namespace: int32(obj.GetNamespace()), MaxSizeBytes: 1 << 20})

	// A second object whose chunk the first object's ticket must not reach.
	other := []byte("a different object's only chunk")
	h.do(http.MethodPut, "/v1/chunks/"+sha(other), bytes.NewReader(other), map[string]string{headerServiceKey: testServiceKey})

	cases := []struct {
		name   string
		method string
		path   string
		header map[string]string
		body   []byte
		want   int
	}{
		{"put without ticket", http.MethodPut, "/v1/chunks/" + sha([]byte("new")), nil, []byte("new"), http.StatusUnauthorized},
		{"put with read ticket", http.MethodPut, "/v1/chunks/" + sha([]byte("new")), map[string]string{headerAuthorization: "Bearer " + readObj}, []byte("new"), http.StatusForbidden},
		{"put with upload ticket", http.MethodPut, "/v1/chunks/" + sha([]byte("new")), map[string]string{headerAuthorization: "Bearer " + upload}, []byte("new"), http.StatusCreated},
		{"put ignores query token", http.MethodPut, "/v1/chunks/" + sha([]byte("q")) + "?token=" + upload, nil, []byte("q"), http.StatusUnauthorized},
		{"get chunk without ticket", http.MethodGet, "/v1/chunks/" + chunk, nil, nil, http.StatusUnauthorized},
		{"get own chunk by query token", http.MethodGet, "/v1/chunks/" + chunk + "?token=" + readObj, nil, nil, http.StatusOK},
		{"head own chunk by query token", http.MethodHead, "/v1/chunks/" + chunk + "?token=" + readObj, nil, nil, http.StatusOK},
		{"get another object's chunk", http.MethodGet, "/v1/chunks/" + sha(other) + "?token=" + readObj, nil, nil, http.StatusForbidden},
		{"get chunk with upload ticket", http.MethodGet, "/v1/chunks/" + chunk + "?token=" + upload, nil, nil, http.StatusForbidden},
		{"get thumbnail chunk ticket", http.MethodGet, "/v1/chunks/" + sha(other) + "?token=" + mint(t, ticket.Claims{Kind: ticket.KindRead, ChunkSHA256: sha(other)}), nil, nil, http.StatusOK},
		{"thumbnail ticket on another chunk", http.MethodGet, "/v1/chunks/" + chunk + "?token=" + mint(t, ticket.Claims{Kind: ticket.KindRead, ChunkSHA256: sha(other)}), nil, nil, http.StatusForbidden},
		{"get chunk with service key", http.MethodGet, "/v1/chunks/" + chunk, map[string]string{headerServiceKey: testServiceKey}, nil, http.StatusOK},
		{"bad query token", http.MethodGet, "/v1/chunks/" + chunk + "?token=v1.nope.nope", nil, nil, http.StatusUnauthorized},
		{"stream without ticket", http.MethodGet, "/v1/stream/" + obj.GetId(), nil, nil, http.StatusUnauthorized},
		{"stream another object", http.MethodGet, "/v1/stream/other-object?token=" + readObj, nil, nil, http.StatusForbidden},
		{"stream with bearer", http.MethodGet, "/v1/stream/" + obj.GetId(), map[string]string{headerAuthorization: "Bearer " + readObj}, nil, http.StatusOK},
	}
	for _, tc := range cases {
		var body *bytes.Reader
		if tc.body != nil {
			body = bytes.NewReader(tc.body)
		} else {
			body = bytes.NewReader(nil)
		}
		res, data := h.do(tc.method, tc.path, body, tc.header)
		if res.StatusCode != tc.want {
			t.Errorf("%s: status %d, want %d (body %s)", tc.name, res.StatusCode, tc.want, data)
		}
	}
}

// Video elements only have a URL, so the token in the query must work with range requests.
func TestStreamURLWithTokenServesRanges(t *testing.T) {
	h := newAuthHarness(t)
	obj, _ := h.seed()
	url := "/v1/stream/" + obj.GetId() + "?token=" + mint(t, ticket.Claims{Kind: ticket.KindRead, ObjectID: obj.GetId()})
	res, data := h.do(http.MethodGet, url, nil, map[string]string{headerRange: "bytes=100-199"})
	if res.StatusCode != http.StatusPartialContent {
		t.Fatalf("status %d, want 206 (body %s)", res.StatusCode, data)
	}
	if !bytes.Equal(data, pattern(1000)[100:200]) {
		t.Fatal("range body does not match the uploaded bytes")
	}
}

func TestCORSAllowsAuthorization(t *testing.T) {
	h := newAuthHarness(t)
	res, _ := h.do(http.MethodOptions, "/v1/chunks/"+sha([]byte("x")), nil, map[string]string{"Origin": "http://localhost:3001"})
	if got := res.Header.Get(headerCORSAllowHeaders); !bytes.Contains([]byte(got), []byte(headerAuthorization)) {
		t.Fatalf("allow headers %q lack Authorization", got)
	}
}

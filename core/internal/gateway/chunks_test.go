package gateway

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/lumavault/lumavault/core/internal/constants"
)

func TestPutChunk(t *testing.T) {
	h := newHarness(t)
	data := []byte("hello chunk")
	res, body := h.do(http.MethodPut, "/v1/chunks/"+sha(data), bytes.NewReader(data), nil)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("status %d body %s", res.StatusCode, body)
	}
	var got putChunkResponse
	if err := json.Unmarshal(body, &got); err != nil || got.SHA256 != sha(data) || got.SizeBytes != int64(len(data)) {
		t.Fatalf("body %s: %+v %v", body, got, err)
	}
}

func TestPutChunkRejects(t *testing.T) {
	h := newHarness(t)
	data := []byte("payload")

	t.Run("hash mismatch", func(t *testing.T) {
		res, body := h.do(http.MethodPut, "/v1/chunks/"+sha([]byte("other")), bytes.NewReader(data), nil)
		wantJSONError(t, res, body, http.StatusBadRequest)
	})
	t.Run("invalid hex", func(t *testing.T) {
		res, body := h.do(http.MethodPut, "/v1/chunks/"+strings.Repeat("Z", 64), bytes.NewReader(data), nil)
		wantJSONError(t, res, body, http.StatusBadRequest)
	})
	t.Run("oversized with content length", func(t *testing.T) {
		big := io.LimitReader(zeroReader{}, constants.MaxChunkSizeBytes+1)
		req, _ := http.NewRequest(http.MethodPut, h.srv.URL+"/v1/chunks/"+sha(data), big)
		req.ContentLength = constants.MaxChunkSizeBytes + 1
		res, err := h.srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		wantJSONError(t, res, body, http.StatusRequestEntityTooLarge)
	})
	t.Run("oversized chunked", func(t *testing.T) {
		big := io.LimitReader(zeroReader{}, constants.MaxChunkSizeBytes+1)
		res, body := h.do(http.MethodPut, "/v1/chunks/"+sha(data), io.NopCloser(big), nil)
		wantJSONError(t, res, body, http.StatusRequestEntityTooLarge)
	})
	if left := h.tmpFiles(); len(left) != 0 {
		t.Fatalf("orphaned staging files: %v", left)
	}
}

func TestGetChunk(t *testing.T) {
	h := newHarness(t)
	data := []byte("chunk body")
	h.putChunk(data)
	path := "/v1/chunks/" + sha(data)

	res, body := h.do(http.MethodGet, path, nil, nil)
	if res.StatusCode != http.StatusOK || !bytes.Equal(body, data) {
		t.Fatalf("GET: %d %q", res.StatusCode, body)
	}
	for k, want := range map[string]string{
		"Content-Type":   "application/octet-stream",
		"Content-Length": "10",
		"ETag":           `"` + sha(data) + `"`,
		"Cache-Control":  "public, max-age=31536000, immutable",
	} {
		if got := res.Header.Get(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}

	res, body = h.do(http.MethodHead, path, nil, nil)
	if res.StatusCode != http.StatusOK || len(body) != 0 || res.Header.Get("Content-Length") != "10" {
		t.Fatalf("HEAD: %d len %d cl %q", res.StatusCode, len(body), res.Header.Get("Content-Length"))
	}

	res, _ = h.do(http.MethodGet, path, nil, map[string]string{"If-None-Match": `W/"x", "` + sha(data) + `"`})
	if res.StatusCode != http.StatusNotModified {
		t.Fatalf("If-None-Match: %d", res.StatusCode)
	}

	res, body = h.do(http.MethodGet, "/v1/chunks/"+sha([]byte("absent")), nil, nil)
	wantJSONError(t, res, body, http.StatusNotFound)
	res, body = h.do(http.MethodGet, "/v1/chunks/short", nil, nil)
	wantJSONError(t, res, body, http.StatusBadRequest)
}

func wantJSONError(t *testing.T, res *http.Response, body []byte, status int) {
	t.Helper()
	if res.StatusCode != status {
		t.Fatalf("status %d, want %d (body %s)", res.StatusCode, status, body)
	}
	var e struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &e); err != nil || e.Error == "" {
		t.Fatalf("want {\"error\": ...} body, got %s", body)
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

package gateway

import (
	"net/http"
	"strings"
	"testing"
)

func TestCORSPreflight(t *testing.T) {
	h := newHarness(t)
	res, _ := h.do(http.MethodOptions, "/v1/chunks/"+sha([]byte("x")), nil, map[string]string{
		"Origin":                         "http://localhost:5173",
		"Access-Control-Request-Method":  "PUT",
		"Access-Control-Request-Headers": "content-type",
	})
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("preflight status %d", res.StatusCode)
	}
	if res.Header.Get("Access-Control-Allow-Origin") != "*" || !strings.Contains(res.Header.Get("Access-Control-Allow-Methods"), "PUT") {
		t.Fatalf("preflight headers: %v", res.Header)
	}
	for _, hdr := range []string{"Range", "If-Range", "Connect-Protocol-Version", "X-Grpc-Web"} {
		if !strings.Contains(res.Header.Get("Access-Control-Allow-Headers"), hdr) {
			t.Errorf("Allow-Headers missing %s", hdr)
		}
	}
}

func TestCORSExposesStreamingHeaders(t *testing.T) {
	h := newHarness(t)
	obj := h.upload(pattern(10), 10)
	res, _ := h.do(http.MethodGet, "/v1/stream/"+obj.GetId(), nil, map[string]string{"Range": "bytes=0-1"})
	exposed := res.Header.Get("Access-Control-Expose-Headers")
	for _, hdr := range []string{"Content-Range", "Accept-Ranges", "Content-Length", "ETag", "Grpc-Status"} {
		if !strings.Contains(exposed, hdr) {
			t.Errorf("Expose-Headers missing %s", hdr)
		}
	}
}

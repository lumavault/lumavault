package gateway

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// The test object is 2500 bytes in 1000-byte chunks: h0 [0,999], h1 [1000,1999], h2 [2000,2499].
const streamSize = 2500

func TestStreamRanges(t *testing.T) {
	h := newHarness(t)
	data := pattern(streamSize)
	obj := h.upload(data, 1000)
	path := "/v1/stream/" + obj.GetId()
	etag := `"` + obj.GetSha256Digest() + `"`

	cases := []struct {
		name               string
		header             map[string]string
		status             int
		start, end         int64
		wantGets, wantRngs int64
	}{
		{"full", nil, 200, 0, 2499, 3, 0},
		{"single chunk", map[string]string{"Range": "bytes=10-19"}, 206, 10, 19, 0, 1},
		{"straddles three chunks", map[string]string{"Range": "bytes=900-2099"}, 206, 900, 2099, 1, 2},
		{"suffix", map[string]string{"Range": "bytes=-1024"}, 206, 1476, 2499, 1, 1},
		{"suffix larger than object", map[string]string{"Range": "bytes=-1048576"}, 206, 0, 2499, 3, 0},
		{"open ended clamped", map[string]string{"Range": "bytes=2000-999999999"}, 206, 2000, 2499, 1, 0},
		{"open ended", map[string]string{"Range": "bytes=1500-"}, 206, 1500, 2499, 1, 1},
		{"if-range match keeps range", map[string]string{"Range": "bytes=0-9", "If-Range": etag}, 206, 0, 9, 0, 1},
		{"if-range mismatch sends all", map[string]string{"Range": "bytes=0-9", "If-Range": `"stale"`}, 200, 0, 2499, 3, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h.chunks.reset()
			res, body := h.do(http.MethodGet, path, nil, tc.header)
			if res.StatusCode != tc.status {
				t.Fatalf("status %d, want %d", res.StatusCode, tc.status)
			}
			if !bytes.Equal(body, data[tc.start:tc.end+1]) {
				t.Fatalf("body mismatch: got %d bytes, want [%d,%d]", len(body), tc.start, tc.end)
			}
			if got, want := res.Header.Get("Content-Length"), fmt.Sprint(tc.end-tc.start+1); got != want {
				t.Errorf("Content-Length %s, want %s", got, want)
			}
			wantCR := ""
			if tc.status == 206 {
				wantCR = fmt.Sprintf("bytes %d-%d/%d", tc.start, tc.end, streamSize)
			}
			if got := res.Header.Get("Content-Range"); got != wantCR {
				t.Errorf("Content-Range %q, want %q", got, wantCR)
			}
			if res.Header.Get("Accept-Ranges") != "bytes" || res.Header.Get("ETag") != etag || res.Header.Get("Content-Type") != "video/mp4" {
				t.Errorf("headers: %v", res.Header)
			}
			if g, r := h.chunks.gets.Load(), h.chunks.ranges.Load(); g != tc.wantGets || r != tc.wantRngs {
				t.Errorf("GetChunk=%d ReadChunkRange=%d, want %d and %d", g, r, tc.wantGets, tc.wantRngs)
			}
		})
	}
}

func TestStreamHeadAndConditional(t *testing.T) {
	h := newHarness(t)
	obj := h.upload(pattern(streamSize), 1000)
	path := "/v1/stream/" + obj.GetId()
	h.chunks.reset()

	res, body := h.do(http.MethodHead, path, nil, nil)
	if res.StatusCode != 200 || len(body) != 0 || res.Header.Get("Content-Length") != "2500" {
		t.Fatalf("HEAD 200: %d len %d cl %q", res.StatusCode, len(body), res.Header.Get("Content-Length"))
	}
	res, body = h.do(http.MethodHead, path, nil, map[string]string{"Range": "bytes=100-199"})
	if res.StatusCode != 206 || len(body) != 0 || res.Header.Get("Content-Length") != "100" ||
		res.Header.Get("Content-Range") != "bytes 100-199/2500" {
		t.Fatalf("HEAD 206: %d len %d headers %v", res.StatusCode, len(body), res.Header)
	}
	res, _ = h.do(http.MethodGet, path, nil, map[string]string{"If-None-Match": `"` + obj.GetSha256Digest() + `"`})
	if res.StatusCode != http.StatusNotModified {
		t.Fatalf("If-None-Match: %d", res.StatusCode)
	}
	if g, r := h.chunks.gets.Load(), h.chunks.ranges.Load(); g+r != 0 {
		t.Fatalf("HEAD/304 read chunks: gets=%d ranges=%d", g, r)
	}
}

func TestStreamNotSatisfiable(t *testing.T) {
	empty := legacyEmptyObject()
	h := newHarness(t, empty)
	obj := h.upload(pattern(streamSize), 1000)
	h.chunks.reset()

	for _, tc := range []struct{ id, rng, total string }{
		{obj.GetId(), "bytes=2500-", "2500"},
		{obj.GetId(), "bytes=5-2", "2500"},
		{obj.GetId(), "items=0-1", "2500"},
		{obj.GetId(), "bytes=0-1,5-6", "2500"},
		{obj.GetId(), "bytes=-0", "2500"},
		{obj.GetId(), "bytes=abc", "2500"},
		{empty.GetId(), "bytes=0-", "0"},
	} {
		res, _ := h.do(http.MethodGet, "/v1/stream/"+tc.id, nil, map[string]string{"Range": tc.rng})
		if res.StatusCode != http.StatusRequestedRangeNotSatisfiable || res.Header.Get("Content-Range") != "bytes */"+tc.total {
			t.Errorf("Range %q: %d Content-Range %q", tc.rng, res.StatusCode, res.Header.Get("Content-Range"))
		}
	}
	if g, r := h.chunks.gets.Load(), h.chunks.ranges.Load(); g+r != 0 {
		t.Fatalf("416 responses read chunks: gets=%d ranges=%d", g, r)
	}
}

func TestStreamLegacyEmptyObject(t *testing.T) {
	obj := legacyEmptyObject()
	h := newHarness(t, obj)
	res, body := h.do(http.MethodGet, "/v1/stream/"+obj.GetId(), nil, nil)
	if res.StatusCode != 200 || len(body) != 0 || res.Header.Get("Content-Length") != "0" {
		t.Fatalf("empty: %d len %d", res.StatusCode, len(body))
	}
}

func TestStreamErrors(t *testing.T) {
	h := newHarness(t)
	res, body := h.do(http.MethodGet, "/v1/stream/missing", nil, nil)
	wantJSONError(t, res, body, http.StatusNotFound)
	res, body = h.do(http.MethodGet, "/v1/stream/..", nil, nil)
	if res.StatusCode != http.StatusBadRequest && res.StatusCode != http.StatusNotFound {
		t.Fatalf("dot id: %d %s", res.StatusCode, body)
	}

	data := pattern(streamSize)
	obj := h.upload(data, 1000)
	first := obj.GetChunkHashes()[0]
	if err := os.Remove(filepath.Join(h.chunkRoot, "chunks", first[:2], first[2:4], first)); err != nil {
		t.Fatal(err)
	}
	res, body = h.do(http.MethodGet, "/v1/stream/"+obj.GetId(), nil, nil)
	wantJSONError(t, res, body, http.StatusInternalServerError)
	if res.Header.Get("Content-Range") != "" {
		t.Fatalf("error response kept Content-Range %q", res.Header.Get("Content-Range"))
	}
}

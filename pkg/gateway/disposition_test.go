package gateway

import (
	"mime"
	"net/http"
	"strings"
	"testing"
)

func TestAttachmentDisposition(t *testing.T) {
	cases := []struct {
		name, filename, want string
	}{
		{"plain", "clip.mp4", "attachment; filename=clip.mp4"},
		{"empty", "", "attachment"},
		{"spaces", "my movie.mp4", `attachment; filename="my movie.mp4"`},
		{"quotes and backslash", `say "hi"\now.mp4`, `attachment; filename="say \"hi\"\\now.mp4"`},
		{"non-ASCII", "café ☕.mp4", "attachment; filename*=utf-8''caf%C3%A9%20%E2%98%95.mp4"},
		{"header injection", "a\r\nSet-Cookie: x=1.mp4", "attachment; filename*=utf-8''a%0D%0ASet-Cookie%3A%20x%3D1.mp4"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := attachmentDisposition(tc.filename)
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			if strings.ContainsAny(got, "\r\n") {
				t.Fatalf("header value contains a line break: %q", got)
			}
			kind, params, err := mime.ParseMediaType(got)
			if err != nil || kind != "attachment" || params["filename"] != tc.filename {
				t.Fatalf("round trip: kind %q params %v err %v", kind, params, err)
			}
		})
	}
}

func TestStreamDownloadOptIn(t *testing.T) {
	h := newHarness(t)
	data := pattern(streamSize)
	obj := h.upload(data, 1000)
	path := "/v1/stream/" + obj.GetId()

	cases := []struct {
		name, method, query string
		header              map[string]string
		status              int
		wantDisposition     string
	}{
		{"stream stays inline", http.MethodGet, "", nil, 200, ""},
		{"download", http.MethodGet, "?download=1", nil, 200, "attachment; filename=clip.mp4"},
		{"other values stay inline", http.MethodGet, "?download=true", nil, 200, ""},
		{"ranged download", http.MethodGet, "?download=1", map[string]string{"Range": "bytes=900-2099"}, 206, "attachment; filename=clip.mp4"},
		{"head download", http.MethodHead, "?download=1", nil, 200, "attachment; filename=clip.mp4"},
		{"unsatisfiable range has no attachment", http.MethodGet, "?download=1", map[string]string{"Range": "bytes=5000-"}, 416, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, _ := h.do(tc.method, path+tc.query, nil, tc.header)
			if res.StatusCode != tc.status {
				t.Fatalf("status %d, want %d", res.StatusCode, tc.status)
			}
			if got := res.Header.Get("Content-Disposition"); got != tc.wantDisposition {
				t.Fatalf("Content-Disposition %q, want %q", got, tc.wantDisposition)
			}
		})
	}
}

func TestStreamDownloadEscapesFilename(t *testing.T) {
	h := newHarness(t)
	data := pattern(streamSize)
	parts, hashes := split(data, 1000)
	for _, p := range parts {
		h.putChunk(p)
	}
	for _, name := range []string{"", "my movie.mp4", `say "hi".mp4`, "café ☕.mp4"} {
		t.Run(name, func(t *testing.T) {
			req := commitReq(data, 1000, hashes)
			req.Filename = name
			req.SkipDedup = true
			res, err := h.client.CommitObject(t.Context(), req)
			if err != nil {
				t.Fatalf("CommitObject: %v", err)
			}
			hres, _ := h.do(http.MethodHead, "/v1/stream/"+res.GetObject().GetId()+"?download=1", nil, nil)
			kind, params, err := mime.ParseMediaType(hres.Header.Get("Content-Disposition"))
			if err != nil || kind != "attachment" || params["filename"] != name {
				t.Fatalf("Content-Disposition %q: kind %q params %v err %v", hres.Header.Get("Content-Disposition"), kind, params, err)
			}
		})
	}
}

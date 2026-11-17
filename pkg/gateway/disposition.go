package gateway

import (
	"mime"
	"net/http"
)

// wantsDownload reports whether the caller opted in to a browser download with download=1.
func wantsDownload(r *http.Request) bool {
	return r.URL.Query().Get(queryDownload) == queryDownloadOn
}

// attachmentDisposition builds a Content-Disposition attachment value for filename.
// FormatMediaType escapes quotes and backslashes, and switches to RFC 2231 filename* encoding
// for non-ASCII or control bytes so no filename can break the header.
func attachmentDisposition(filename string) string {
	if filename == "" {
		return dispositionAttachment
	}
	if v := mime.FormatMediaType(dispositionAttachment, map[string]string{dispositionFilename: filename}); v != "" {
		return v
	}
	return dispositionAttachment
}

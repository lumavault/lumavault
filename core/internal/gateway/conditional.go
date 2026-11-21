package gateway

import "strings"

// quoteETag turns a SHA-256 hex digest into a strong ETag value.
func quoteETag(hash string) string {
	return `"` + hash + `"`
}

// etagMatchesAny reports whether an If-None-Match header matches etag, using the weak
// comparison RFC 9110 requires for If-None-Match (a W/ prefix is ignored).
func etagMatchesAny(header, etag string) bool {
	if header == "" {
		return false
	}
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
			return true
		}
	}
	return false
}

// ifRangeAllowsRange reports whether a Range header should be honored given If-Range.
// Only a strong ETag equal to etag keeps the range; anything else (including dates)
// falls back to a full 200 response.
func ifRangeAllowsRange(header, etag string) bool {
	return header == "" || strings.TrimSpace(header) == etag
}

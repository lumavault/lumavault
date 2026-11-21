package gateway

import (
	"errors"
	"strconv"
	"strings"
)

// errRangeNotSatisfiable means the Range header must be answered with 416.
var errRangeNotSatisfiable = errors.New("gateway: range not satisfiable")

// byteRange is an inclusive byte range [start, end] within an object.
type byteRange struct {
	start, end int64
}

func (br byteRange) length() int64 { return br.end - br.start + 1 }

// parseRange parses a single RFC 9110 bytes range against an object of size bytes.
// It supports "start-end", "start-", and "-suffix", clamps end and oversized suffixes to
// the object, and rejects other units, multiple ranges, empty objects, and malformed input.
func parseRange(header string, size int64) (byteRange, error) {
	if len(header) < len(rangeSpecPrefix) || !strings.EqualFold(header[:len(rangeSpecPrefix)], rangeSpecPrefix) {
		return byteRange{}, errRangeNotSatisfiable
	}
	spec := strings.TrimSpace(header[len(rangeSpecPrefix):])
	if spec == "" || strings.Contains(spec, ",") || size <= 0 {
		return byteRange{}, errRangeNotSatisfiable
	}
	startStr, endStr, ok := strings.Cut(spec, "-")
	if !ok {
		return byteRange{}, errRangeNotSatisfiable
	}
	startStr, endStr = strings.TrimSpace(startStr), strings.TrimSpace(endStr)

	if startStr == "" {
		suffix, err := parseNonNegative(endStr)
		if err != nil || suffix <= 0 {
			return byteRange{}, errRangeNotSatisfiable
		}
		return byteRange{start: max(size-suffix, 0), end: size - 1}, nil
	}

	start, err := parseNonNegative(startStr)
	if err != nil || start >= size {
		return byteRange{}, errRangeNotSatisfiable
	}
	end := size - 1
	if endStr != "" {
		e, err := parseNonNegative(endStr)
		if err != nil || start > e {
			return byteRange{}, errRangeNotSatisfiable
		}
		end = min(e, size-1)
	}
	return byteRange{start: start, end: end}, nil
}

// parseNonNegative parses a plain decimal integer with no sign.
func parseNonNegative(s string) (int64, error) {
	if s == "" || s[0] == '+' || s[0] == '-' {
		return 0, strconv.ErrSyntax
	}
	return strconv.ParseInt(s, 10, 64)
}

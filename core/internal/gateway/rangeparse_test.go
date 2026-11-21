package gateway

import "testing"

func TestParseRange(t *testing.T) {
	const size = 100
	ok := []struct {
		in         string
		start, end int64
	}{
		{"bytes=0-0", 0, 0},
		{"bytes=0-99", 0, 99},
		{"bytes=10-", 10, 99},
		{"bytes=90-500", 90, 99},
		{"bytes=-10", 90, 99},
		{"bytes=-1000", 0, 99},
		{"Bytes= 5-6", 5, 6},
	}
	for _, tc := range ok {
		br, err := parseRange(tc.in, size)
		if err != nil || br.start != tc.start || br.end != tc.end {
			t.Errorf("parseRange(%q) = %+v, %v; want [%d,%d]", tc.in, br, err, tc.start, tc.end)
		}
	}
	for _, in := range []string{
		"", "bytes", "bytes=", "items=0-1", "bytes=0-1,2-3", "bytes=100-", "bytes=5-4",
		"bytes=-0", "bytes=-", "bytes=a-b", "bytes=-5-", "bytes=+1-2", "bytes=1--2", "bytes=1",
	} {
		if _, err := parseRange(in, size); err != errRangeNotSatisfiable {
			t.Errorf("parseRange(%q) err = %v, want errRangeNotSatisfiable", in, err)
		}
	}
	if _, err := parseRange("bytes=0-", 0); err != errRangeNotSatisfiable {
		t.Errorf("empty object: err = %v", err)
	}
}

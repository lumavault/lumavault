package validate

import (
	"errors"
	"strings"
	"testing"

	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
)

var (
	goodHash  = strings.Repeat("a", 64)
	goodHash2 = strings.Repeat("b", 64)
)

func TestHash(t *testing.T) {
	cases := map[string]bool{
		goodHash:                       true,
		strings.Repeat("0", 64):        true,
		"":                             false,
		strings.Repeat("a", 63):        false,
		strings.Repeat("a", 65):        false,
		strings.Repeat("A", 64):        false,
		strings.Repeat("a", 63) + "g":  false,
		strings.Repeat("a", 62) + "/.": false,
	}
	for in, ok := range cases {
		err := Hash(in)
		if ok && err != nil {
			t.Errorf("Hash(%q) = %v, want nil", in, err)
		}
		if !ok && !errors.Is(err, ErrInvalid) {
			t.Errorf("Hash(%q) = %v, want ErrInvalid", in, err)
		}
	}
}

func TestNamespace(t *testing.T) {
	for _, ns := range []lumavaultv1.Namespace{
		lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		lumavaultv1.Namespace_NAMESPACE_CINEMA,
		lumavaultv1.Namespace_NAMESPACE_GAMES,
	} {
		if err := Namespace(ns); err != nil {
			t.Errorf("Namespace(%v) = %v, want nil", ns, err)
		}
	}
	for _, ns := range []lumavaultv1.Namespace{lumavaultv1.Namespace_NAMESPACE_UNSPECIFIED, 99} {
		if err := Namespace(ns); !errors.Is(err, ErrInvalid) {
			t.Errorf("Namespace(%v) = %v, want ErrInvalid", ns, err)
		}
	}
}

func TestObjectID(t *testing.T) {
	if err := ObjectID("0b8f5c1e-7d1a-4c39-9a35-2f1b1e0c6d11"); err != nil {
		t.Errorf("ObjectID(uuid) = %v, want nil", err)
	}
	for _, id := range []string{"", ".", "..", "a/b", `a\b`, "../x"} {
		if err := ObjectID(id); !errors.Is(err, ErrInvalid) {
			t.Errorf("ObjectID(%q) = %v, want ErrInvalid", id, err)
		}
	}
}

func TestCommitRequest(t *testing.T) {
	valid := func() *lumavaultv1.CommitObjectRequest {
		return &lumavaultv1.CommitObjectRequest{
			Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
			SizeBytes:      10,
			ChunkSizeBytes: 4,
			Sha256Digest:   goodHash,
			ChunkHashes:    []string{goodHash, goodHash2, goodHash},
		}
	}
	if err := CommitRequest(valid()); err != nil {
		t.Fatalf("valid request: %v", err)
	}
	empty := &lumavaultv1.CommitObjectRequest{Namespace: lumavaultv1.Namespace_NAMESPACE_GAMES, Sha256Digest: goodHash}
	if err := CommitRequest(empty); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty object: got %v, want ErrInvalid", err)
	}

	bad := map[string]func(r *lumavaultv1.CommitObjectRequest){
		"unspecified namespace":  func(r *lumavaultv1.CommitObjectRequest) { r.Namespace = 0 },
		"bad digest":             func(r *lumavaultv1.CommitObjectRequest) { r.Sha256Digest = "x" },
		"bad thumbnail":          func(r *lumavaultv1.CommitObjectRequest) { r.ThumbnailChunkHash = "x" },
		"bad chunk hash":         func(r *lumavaultv1.CommitObjectRequest) { r.ChunkHashes[1] = "x" },
		"chunk size too big":     func(r *lumavaultv1.CommitObjectRequest) { r.ChunkSizeBytes = 64<<20 + 1 },
		"zero chunk size":        func(r *lumavaultv1.CommitObjectRequest) { r.ChunkSizeBytes = 0 },
		"too few chunks":         func(r *lumavaultv1.CommitObjectRequest) { r.ChunkHashes = r.ChunkHashes[:2] },
		"too many chunks":        func(r *lumavaultv1.CommitObjectRequest) { r.ChunkHashes = append(r.ChunkHashes, goodHash) },
		"empty size with chunks": func(r *lumavaultv1.CommitObjectRequest) { r.SizeBytes = 0 },
		"size without chunks":    func(r *lumavaultv1.CommitObjectRequest) { r.ChunkHashes = nil },
	}
	for name, mutate := range bad {
		r := valid()
		mutate(r)
		if err := CommitRequest(r); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: got %v, want ErrInvalid", name, err)
		}
	}
	if err := CommitRequest(nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("nil request: got %v, want ErrInvalid", err)
	}
}

func TestChunkSizes(t *testing.T) {
	goodHash3 := strings.Repeat("c", 64)

	validCases := []struct {
		name  string
		req   *lumavaultv1.CommitObjectRequest
		sizes map[string]int64
	}{
		{
			name: "single exact chunk",
			req: &lumavaultv1.CommitObjectRequest{
				SizeBytes:      1000,
				ChunkSizeBytes: 1000,
				ChunkHashes:    []string{goodHash},
			},
			sizes: map[string]int64{goodHash: 1000},
		},
		{
			name: "single partial chunk",
			req: &lumavaultv1.CommitObjectRequest{
				SizeBytes:      500,
				ChunkSizeBytes: 1000,
				ChunkHashes:    []string{goodHash},
			},
			sizes: map[string]int64{goodHash: 500},
		},
		{
			name: "multi chunk with partial tail",
			req: &lumavaultv1.CommitObjectRequest{
				SizeBytes:      2500,
				ChunkSizeBytes: 1000,
				ChunkHashes:    []string{goodHash, goodHash2, goodHash3},
			},
			sizes: map[string]int64{goodHash: 1000, goodHash2: 1000, goodHash3: 500},
		},
		{
			name: "multi chunk with full tail and repeated hash",
			req: &lumavaultv1.CommitObjectRequest{
				SizeBytes:      2000,
				ChunkSizeBytes: 1000,
				ChunkHashes:    []string{goodHash, goodHash},
			},
			sizes: map[string]int64{goodHash: 1000},
		},
	}
	for _, tc := range validCases {
		t.Run("valid/"+tc.name, func(t *testing.T) {
			if err := ChunkSizes(tc.req, tc.sizes); err != nil {
				t.Fatalf("ChunkSizes: %v", err)
			}
		})
	}

	req := &lumavaultv1.CommitObjectRequest{
		SizeBytes:      2500,
		ChunkSizeBytes: 1000,
		ChunkHashes:    []string{goodHash, goodHash2, goodHash3},
	}
	invalidCases := map[string]map[string]int64{
		"interior chunk short": {goodHash: 1000, goodHash2: 999, goodHash3: 500},
		"interior chunk long":  {goodHash: 1001, goodHash2: 1000, goodHash3: 500},
		"tail chunk short":     {goodHash: 1000, goodHash2: 1000, goodHash3: 499},
		"tail chunk long":      {goodHash: 1000, goodHash2: 1000, goodHash3: 501},
		"missing chunk size":   {goodHash: 1000, goodHash2: 1000},
	}
	for name, sizes := range invalidCases {
		t.Run("invalid/"+name, func(t *testing.T) {
			if err := ChunkSizes(req, sizes); !errors.Is(err, ErrInvalid) {
				t.Errorf("ChunkSizes = %v, want ErrInvalid", err)
			}
		})
	}
}

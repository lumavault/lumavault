// Package constants defines shared storage invariants across LumaVault Go packages.
package constants

const (
	// MaxChunkSizeBytes is the maximum allowed size (64 MiB) for a single content-addressed chunk.
	MaxChunkSizeBytes = 64 << 20

	// SHA256HexLen is the exact character length of a lowercase hex-encoded SHA-256 digest.
	SHA256HexLen = 64
)

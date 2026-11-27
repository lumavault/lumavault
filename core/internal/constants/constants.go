// Package constants defines shared storage invariants across LumaVault Go packages.
package constants

const (
	// MaxChunkSizeBytes is the maximum allowed size (64 MiB) for a single content-addressed chunk.
	MaxChunkSizeBytes = 64 << 20

	// SHA256HexLen is the exact character length of a lowercase hex-encoded SHA-256 digest.
	SHA256HexLen = 64

	// StreamBufferSize is the buffer size (32 KiB) used when streaming chunk data.
	StreamBufferSize = 32 << 10
)

// Mutable ObjectMetadata FieldMask paths accepted by UpdateObjectMetadata.
const (
	FieldFilename           = "filename"
	FieldMimeType           = "mime_type"
	FieldThumbnailChunkHash = "thumbnail_chunk_hash"
)

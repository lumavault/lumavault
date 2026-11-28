// Package metadata defines the control-plane MetadataStore interface,
// the deterministic in-memory metadata state machine (Engine), and the
// Day-1 per-object LocalMetadataStore implementation.
package metadata

import (
	"context"
	"errors"

	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
)

var (
	// ErrObjectNotFound is returned when a requested object_id does not exist.
	ErrObjectNotFound = errors.New("metadata: object not found")

	// ErrInvalidArgument is returned when a request fails validation, contains invalid SHA-256 digests,
	// violates chunk size/count invariants, or specifies an empty or disallowed FieldMask.
	ErrInvalidArgument = errors.New("metadata: invalid argument")
)

// MetadataStore is the pluggable Control Plane storage contract for content-addressed
// object manifests, idempotent (namespace, sha256_digest) deduplication, storage-level
// metadata updates, and chunk reference tracking.
//
// Application-layer data lives in the shared PostgreSQL application database.
//
// The Gateway (internal/gateway) interacts exclusively with this interface, allowing seamless
// upgrades from the Day-1 LocalMetadataStore to the Project 6 Multi-Paxos replicated store.
type MetadataStore interface {
	// CommitObject validates and commits an object manifest.
	// By default it is idempotent on (namespace, sha256_digest), returning the existing
	// ObjectMetadata with deduplicated=true unless req.SkipDedup is true.
	CommitObject(ctx context.Context, req *lumavaultv1.CommitObjectRequest) (obj *lumavaultv1.ObjectMetadata, deduplicated bool, err error)

	// GetObject retrieves a single object's metadata and chunk manifest by ID.
	// Returns ErrObjectNotFound if the object does not exist.
	GetObject(ctx context.Context, objectID string) (*lumavaultv1.ObjectMetadata, error)

	// UpdateObjectMetadata partially updates mutable storage-level metadata fields
	// (filename, mime_type, thumbnail_chunk_hash) according to a required, non-empty FieldMask.
	UpdateObjectMetadata(ctx context.Context, req *lumavaultv1.UpdateObjectMetadataRequest) (*lumavaultv1.ObjectMetadata, error)

	// DeleteObject deletes an object's metadata record and decrements its chunk reference counts.
	// Returns ErrObjectNotFound if the object does not exist.
	DeleteObject(ctx context.Context, objectID string) error

	// IsChunkReferenced reports whether at least one committed object currently references
	// the given 64-character lowercase hex SHA-256 chunk hash (in chunk_hashes or thumbnail_chunk_hash).
	IsChunkReferenced(ctx context.Context, hash string) (bool, error)
}

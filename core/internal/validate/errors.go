// Package validate holds the single canonical implementation of LumaVault request checks
// (SHA-256 digests, namespaces, object IDs, and commit manifests) shared by the storage
// packages and the Gateway.
package validate

import "errors"

// ErrInvalid is the shared sentinel for invalid requests and inputs across validate,
// chunkstore, metadata, and gateway.
var ErrInvalid = errors.New("validate: invalid input")

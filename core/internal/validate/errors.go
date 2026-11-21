// Package validate holds the single canonical implementation of LumaVault request checks
// (SHA-256 digests, namespaces, object IDs, and commit manifests) shared by the storage
// packages and the Gateway.
package validate

import "errors"

// ErrInvalid is wrapped by every error this package returns. Callers wrap it again with
// their own sentinel (for example metadata.ErrInvalidArgument) so errors.Is matches both.
var ErrInvalid = errors.New("validate: invalid input")

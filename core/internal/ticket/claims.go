// Package ticket parses and verifies the signed storage tickets that apps/api mints, so the
// Gateway can authorize a request without asking Postgres who the caller is.
package ticket

import (
	"errors"
	"fmt"

	"github.com/lumavault/lumavault/core/internal/validate"
)

// Kind says what a ticket allows.
type Kind string

// Claims is the decoded ticket payload. Field order matches the JSON key order the minter uses.
type Claims struct {
	Kind Kind `json:"k"`
	// Exp is the expiry in Unix seconds.
	Exp int64 `json:"exp"`
	// Namespace is the storage Namespace enum value an upload ticket may commit into.
	Namespace int32 `json:"ns,omitempty"`
	// MaxSizeBytes is the largest size_bytes an upload ticket may commit.
	MaxSizeBytes uint64 `json:"max,omitempty"`
	// ObjectID is the one object a read ticket covers.
	ObjectID string `json:"obj,omitempty"`
	// ChunkSHA256 is the one chunk a read ticket covers, used instead of ObjectID for thumbnails.
	ChunkSHA256 string `json:"chk,omitempty"`
}

// Errors returned by Verify. Each wraps one of these, so callers can use errors.Is.
var (
	ErrMalformed = errors.New("ticket: malformed")
	ErrSignature = errors.New("ticket: bad signature")
	ErrExpired   = errors.New("ticket: expired")
	ErrClaims    = errors.New("ticket: invalid claims")
)

// validate checks the fields each kind needs. Expiry is checked separately.
func (c Claims) validate() error {
	if c.Exp == 0 {
		return fmt.Errorf("%w: missing exp", ErrClaims)
	}
	switch c.Kind {
	case KindUpload:
		if c.Namespace <= 0 {
			return fmt.Errorf("%w: upload ticket needs ns", ErrClaims)
		}
		if c.MaxSizeBytes == 0 {
			return fmt.Errorf("%w: upload ticket needs max", ErrClaims)
		}
	case KindRead:
		if (c.ObjectID == "") == (c.ChunkSHA256 == "") {
			return fmt.Errorf("%w: read ticket needs exactly one of obj and chk", ErrClaims)
		}
		if c.ObjectID != "" {
			if err := validate.ObjectID(c.ObjectID); err != nil {
				return fmt.Errorf("%w: obj: %v", ErrClaims, err)
			}
		}
		if c.ChunkSHA256 != "" {
			if err := validate.Hash(c.ChunkSHA256); err != nil {
				return fmt.Errorf("%w: chk: %v", ErrClaims, err)
			}
		}
	default:
		return fmt.Errorf("%w: unknown kind %q", ErrClaims, c.Kind)
	}
	return nil
}

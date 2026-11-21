package chunkstore

import (
	"fmt"

	"github.com/lumavault/lumavault/core/internal/validate"
)

// checkHash tags a internal/validate error with ErrInvalidHash so callers can match either sentinel.
func checkHash(hash string) error {
	if err := validate.Hash(hash); err != nil {
		return fmt.Errorf("%w: %w", ErrInvalidHash, err)
	}
	return nil
}

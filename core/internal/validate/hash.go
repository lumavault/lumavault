package validate

import (
	"fmt"

	"github.com/lumavault/lumavault/core/internal/constants"
)

// Hash checks that hash is a 64-character lowercase hexadecimal SHA-256 digest.
func Hash(hash string) error {
	if len(hash) != constants.SHA256HexLen {
		return fmt.Errorf("%w: hash %q must be %d lowercase hex characters", ErrInvalid, hash, constants.SHA256HexLen)
	}
	for i := 0; i < len(hash); i++ {
		c := hash[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return fmt.Errorf("%w: hash %q contains non-lowercase-hex character %q at index %d", ErrInvalid, hash, c, i)
		}
	}
	return nil
}

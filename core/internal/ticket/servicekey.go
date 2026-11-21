package ticket

import (
	"crypto/sha256"
	"crypto/subtle"
)

// ServiceKeyMatches compares a presented service key with the configured one in constant
// time. Both are hashed first so their lengths leak nothing. An empty configured key never matches.
func ServiceKeyMatches(configured, presented string) bool {
	if configured == "" {
		return false
	}
	a := sha256.Sum256([]byte(configured))
	b := sha256.Sum256([]byte(presented))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

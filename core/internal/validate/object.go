package validate

import (
	"fmt"
	"strings"

	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
)

// Namespace checks that ns is a defined namespace other than NAMESPACE_UNSPECIFIED.
func Namespace(ns lumavaultv1.Namespace) error {
	switch ns {
	case lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		lumavaultv1.Namespace_NAMESPACE_CINEMA,
		lumavaultv1.Namespace_NAMESPACE_GAMES:
		return nil
	default:
		return fmt.Errorf("%w: invalid or unspecified namespace %v", ErrInvalid, ns)
	}
}

// ObjectID rejects empty IDs, "." and "..", and path separators so an ID can never
// escape its directory when a store maps it to a file name.
func ObjectID(id string) error {
	if id == "" || id == "." || id == ".." || strings.ContainsAny(id, `/\`) {
		return fmt.Errorf("%w: invalid object_id %q", ErrInvalid, id)
	}
	return nil
}

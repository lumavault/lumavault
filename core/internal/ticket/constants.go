package ticket

import "time"

const (
	// Prefix starts every ticket. A future format would use another prefix.
	Prefix = "v1."

	// MinSecretBytes is the shortest HMAC key the Gateway accepts.
	MinSecretBytes = 32

	// ClockSkew is how long after its expiry a ticket is still accepted.
	ClockSkew = 30 * time.Second

	// KindUpload tickets allow HasChunks, chunk uploads, and one namespace's commits.
	KindUpload Kind = "up"
	// KindRead tickets allow reading one object, or one chunk such as a thumbnail.
	KindRead Kind = "rd"
)

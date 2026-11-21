package main

import "time"

const (
	defaultAddr          = ":8080"
	defaultDataDir       = ".lumavault"
	defaultGCInterval    = time.Hour
	defaultGCGracePeriod = 24 * time.Hour

	envAddr          = "LUMAVAULT_ADDR"
	envDataDir       = "LUMAVAULT_DATA_DIR"
	envGCInterval    = "LUMAVAULT_GC_INTERVAL"
	envGCGracePeriod = "LUMAVAULT_GC_GRACE_PERIOD"
	// Secrets come only from the environment, never flags, so they stay out of process lists.
	envTicketSecret = "LUMAVAULT_TICKET_SECRET"
	envServiceKey   = "LUMAVAULT_SERVICE_KEY"

	chunkStoreSubdir = "chunkstore"
	metadataSubdir   = "metadata"

	// Streams can run for hours, so only header reads and idle keep-alives are bounded.
	readHeaderTimeout = 10 * time.Second
	idleTimeout       = 120 * time.Second
	shutdownTimeout   = 10 * time.Second
)

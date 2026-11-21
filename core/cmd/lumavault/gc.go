package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/lumavault/lumavault/core/internal/chunkstore"
	"github.com/lumavault/lumavault/core/internal/metadata"
)

// runGC sweeps unreferenced chunks every interval until ctx ends. The first sweep waits a
// full interval. The grace period keeps chunks of in-flight uploads safe before commit.
func runGC(ctx context.Context, log *slog.Logger, chunks chunkstore.ChunkStore, meta metadata.MetadataStore, interval, grace time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	isReferenced := func(hash string) (bool, error) {
		return meta.IsChunkReferenced(ctx, hash)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			deleted, err := chunks.GarbageCollect(ctx, isReferenced, grace)
			if err != nil && ctx.Err() == nil {
				log.Warn("gc sweep failed", "err", err, "deleted", deleted)
				continue
			}
			log.Info("gc sweep", "deleted", deleted)
		}
	}
}

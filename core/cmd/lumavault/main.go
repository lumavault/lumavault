// Command lumavault runs the LumaVault storage server: the Gateway over local chunk and
// metadata stores, plus a background chunk garbage collector.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"

	"github.com/lumavault/lumavault/core/internal/chunkstore"
	"github.com/lumavault/lumavault/core/internal/gateway"
	"github.com/lumavault/lumavault/core/internal/metadata"
	"github.com/lumavault/lumavault/core/internal/ticket"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "lumavault: %v\n", err)
		os.Exit(1)
	}
}

// run serves until ctx is canceled, then shuts down gracefully. Logs go to stdout.
func run(ctx context.Context, args []string, stdout io.Writer) error {
	cfg, err := parseConfig(args)
	if err != nil {
		return err
	}
	log := slog.New(slog.NewTextHandler(stdout, nil))

	chunks, err := chunkstore.NewLocalChunkStore(filepath.Join(cfg.dataDir, chunkStoreSubdir))
	if err != nil {
		return err
	}
	meta, err := metadata.NewLocalMetadataStore(filepath.Join(cfg.dataDir, metadataSubdir))
	if err != nil {
		return err
	}

	var opts []gateway.Option
	if cfg.ticketSecret != "" {
		verifier, err := ticket.NewVerifier([]byte(cfg.ticketSecret))
		if err != nil {
			return err
		}
		opts = append(opts, gateway.WithTicketAuth(verifier, cfg.serviceKey))
	} else {
		log.Warn("storage ticket checks are off; set " + envTicketSecret + " and " + envServiceKey + " to turn them on")
	}

	ln, err := net.Listen("tcp", cfg.addr)
	if err != nil {
		return err
	}
	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)
	server := &http.Server{
		Handler:           gateway.NewHandler(meta, chunks, opts...),
		Protocols:         protocols,
		ReadHeaderTimeout: readHeaderTimeout,
		IdleTimeout:       idleTimeout,
	}

	var wg sync.WaitGroup
	gcCtx, stopGC := context.WithCancel(ctx)
	defer func() {
		stopGC()
		wg.Wait()
	}()
	if cfg.gcInterval > 0 {
		wg.Go(func() { runGC(gcCtx, log, chunks, meta, cfg.gcInterval, cfg.gcGracePeriod) })
	}

	serveErr := make(chan error, 1)
	go func() { serveErr <- server.Serve(ln) }()
	log.Info("listening", "addr", ln.Addr().String(), "data_dir", cfg.dataDir)

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}

	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

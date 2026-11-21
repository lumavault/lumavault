package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/lumavault/lumavault/core/internal/ticket"
)

// config holds the server settings. Each flag falls back to its environment variable,
// then to the built-in default.
type config struct {
	addr          string
	dataDir       string
	gcInterval    time.Duration
	gcGracePeriod time.Duration
	// ticketSecret turns on storage ticket checks when set. serviceKey must be set with it.
	ticketSecret string
	serviceKey   string
}

func parseConfig(args []string) (config, error) {
	var cfg config
	gcInterval, err := durationFromEnv(envGCInterval, defaultGCInterval)
	if err != nil {
		return cfg, err
	}
	gcGrace, err := durationFromEnv(envGCGracePeriod, defaultGCGracePeriod)
	if err != nil {
		return cfg, err
	}

	fs := flag.NewFlagSet("lumavault", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	fs.StringVar(&cfg.addr, "addr", stringFromEnv(envAddr, defaultAddr), "TCP listen address (env "+envAddr+")")
	fs.StringVar(&cfg.dataDir, "data-dir", stringFromEnv(envDataDir, defaultDataDir), "root directory for chunk and metadata stores (env "+envDataDir+")")
	fs.DurationVar(&cfg.gcInterval, "gc-interval", gcInterval, "time between chunk GC sweeps, 0 disables GC (env "+envGCInterval+")")
	fs.DurationVar(&cfg.gcGracePeriod, "gc-grace-period", gcGrace, "minimum age before an unreferenced chunk can be deleted (env "+envGCGracePeriod+")")
	if err := fs.Parse(args); err != nil {
		return cfg, err
	}
	if fs.NArg() > 0 {
		return cfg, fmt.Errorf("unexpected arguments: %v", fs.Args())
	}

	cfg.ticketSecret = os.Getenv(envTicketSecret)
	cfg.serviceKey = os.Getenv(envServiceKey)

	switch {
	case cfg.ticketSecret != "" && len(cfg.ticketSecret) < ticket.MinSecretBytes:
		return cfg, fmt.Errorf("%s must be at least %d bytes", envTicketSecret, ticket.MinSecretBytes)
	case cfg.ticketSecret != "" && cfg.serviceKey == "":
		return cfg, fmt.Errorf("%s is required when %s is set", envServiceKey, envTicketSecret)
	case cfg.ticketSecret == "" && cfg.serviceKey != "":
		return cfg, fmt.Errorf("%s is set but %s is not, so it would never be checked", envServiceKey, envTicketSecret)
	case cfg.addr == "":
		return cfg, errors.New("-addr must not be empty")
	case cfg.dataDir == "":
		return cfg, errors.New("-data-dir must not be empty")
	case cfg.gcInterval < 0:
		return cfg, errors.New("-gc-interval must not be negative")
	case cfg.gcGracePeriod < 0:
		return cfg, errors.New("-gc-grace-period must not be negative")
	}
	return cfg, nil
}

func stringFromEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func durationFromEnv(key string, fallback time.Duration) (time.Duration, error) {
	v, ok := os.LookupEnv(key)
	if !ok {
		return fallback, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return d, nil
}

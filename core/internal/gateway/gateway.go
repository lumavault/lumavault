// Package gateway serves the client-facing LumaVault API: the Connect-RPC StorageService
// control plane and the raw HTTP data plane for chunk transfers and byte-range streaming.
// It talks only to the MetadataStore and ChunkStore interfaces.
package gateway

import (
	"net/http"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/lumavault/lumavault/core/gen/go/lumavault/v1/lumavaultv1connect"
	"github.com/lumavault/lumavault/core/internal/chunkstore"
	"github.com/lumavault/lumavault/core/internal/metadata"
)

// gateway implements lumavaultv1connect.StorageServiceHandler and the data plane handlers.
type gateway struct {
	meta   metadata.MetadataStore
	chunks chunkstore.ChunkStore
	// auth is nil when storage ticket checks are off.
	auth *gatewayAuth
}

var _ lumavaultv1connect.StorageServiceHandler = (*gateway)(nil)

// NewHandler returns the full Gateway HTTP handler: Connect, gRPC, and gRPC-Web routes for
// StorageService, the chunk and stream data plane routes, GET /healthz, and CORS.
func NewHandler(meta metadata.MetadataStore, chunks chunkstore.ChunkStore, opts ...Option) http.Handler {
	gw := &gateway{meta: meta, chunks: chunks}
	for _, opt := range opts {
		opt(gw)
	}

	server := connect.NewServer()
	lumavaultv1connect.RegisterStorageServiceHandler(server, gw)

	mux := http.NewServeMux()
	connecthttp.Mount(mux, server, connecthttp.WithReadMaxBytes(controlPlaneReadMaxBytes))

	// GET patterns also match HEAD requests.
	mux.HandleFunc(routePutChunk, gw.putChunk)
	mux.HandleFunc(routeGetChunk, gw.getChunk)
	mux.HandleFunc(routeStream, gw.stream)
	mux.HandleFunc(routeHealthz, healthz)

	return withCORS(mux)
}

func healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

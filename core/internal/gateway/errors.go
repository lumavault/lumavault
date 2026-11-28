package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"connectrpc.com/connect/v2"
	"github.com/lumavault/lumavault/core/internal/chunkstore"
	"github.com/lumavault/lumavault/core/internal/metadata"
	"github.com/lumavault/lumavault/core/internal/validate"
)

// toConnectError maps store errors to Connect codes. Internal errors are logged and sent
// with a generic message so file paths and other server details stay off the wire.
func toConnectError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*connect.Error](err); ok {
		return err
	}
	code := connect.CodeInternal
	switch {
	case errors.Is(err, validate.ErrInvalid):
		code = connect.CodeInvalidArgument
	case errors.Is(err, metadata.ErrObjectNotFound):
		code = connect.CodeNotFound
	case errors.Is(err, chunkstore.ErrChunkNotFound):
		code = connect.CodeFailedPrecondition
	case errors.Is(err, context.Canceled):
		code = connect.CodeCanceled
	case errors.Is(err, context.DeadlineExceeded):
		code = connect.CodeDeadlineExceeded
	}
	if code == connect.CodeInternal {
		slog.ErrorContext(ctx, "gateway: internal error", "err", err)
		return connect.NewError(code, "internal error").WithCause(err)
	}
	return connect.NewError(code, err.Error()).WithCause(err)
}

// writeJSON writes v as a JSON body with the given status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes the data plane error body {"error": msg}.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// writeInternalError logs err and writes a generic 500 so server details stay off the wire.
func writeInternalError(w http.ResponseWriter, r *http.Request, err error) {
	slog.ErrorContext(r.Context(), "gateway: internal error", "method", r.Method, "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

// logStreamAbort records a failure after the status line was sent. The response is already
// committed, so the client sees a body shorter than Content-Length.
func logStreamAbort(r *http.Request, err error) {
	slog.WarnContext(r.Context(), "gateway: stream aborted", "method", r.Method, "path", r.URL.Path, "err", err)
}

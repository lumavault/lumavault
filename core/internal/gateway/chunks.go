package gateway

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/lumavault/lumavault/core/internal/chunkstore"
	"github.com/lumavault/lumavault/core/internal/constants"
	"github.com/lumavault/lumavault/core/internal/validate"
)

// putChunkResponse is the 201 body for PUT /v1/chunks/{sha256}.
type putChunkResponse struct {
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"size_bytes"`
}

// putChunk streams the request body straight into ChunkStore, which verifies the SHA-256.
func (g *gateway) putChunk(w http.ResponseWriter, r *http.Request) {
	cred, ok := g.httpCredential(w, r)
	if !ok {
		return
	}
	if !cred.upload() {
		writeAuthError(w, denied("chunk uploads"))
		return
	}
	hash := r.PathValue(paramSHA256)
	if err := validate.Hash(hash); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if r.ContentLength > constants.MaxChunkSizeBytes {
		writeError(w, http.StatusRequestEntityTooLarge, chunkstore.ErrChunkTooLarge.Error())
		return
	}

	// One extra byte lets ChunkStore see an oversized body and reject it itself.
	body := http.MaxBytesReader(w, r.Body, constants.MaxChunkSizeBytes+1)
	written, err := g.chunks.PutChunk(r.Context(), hash, body)
	if err != nil {
		var maxErr *http.MaxBytesError
		switch {
		case errors.Is(err, chunkstore.ErrHashMismatch), errors.Is(err, validate.ErrInvalid):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, chunkstore.ErrChunkTooLarge), errors.As(err, &maxErr):
			writeError(w, http.StatusRequestEntityTooLarge, chunkstore.ErrChunkTooLarge.Error())
		default:
			writeInternalError(w, r, err)
		}
		return
	}
	writeJSON(w, http.StatusCreated, putChunkResponse{SHA256: hash, SizeBytes: written})
}

// getChunk serves a whole chunk for GET and HEAD with immutable caching headers.
func (g *gateway) getChunk(w http.ResponseWriter, r *http.Request) {
	cred, ok := g.httpCredential(w, r)
	if !ok {
		return
	}
	hash := r.PathValue(paramSHA256)
	if err := validate.Hash(hash); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	allowed, err := g.allowChunkRead(r.Context(), cred, hash)
	if err != nil {
		writeInternalError(w, r, err)
		return
	}
	if !allowed {
		writeAuthError(w, denied("this chunk"))
		return
	}

	rc, size, err := g.chunks.GetChunk(r.Context(), hash)
	if err != nil {
		if errors.Is(err, chunkstore.ErrChunkNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeInternalError(w, r, err)
		return
	}
	defer rc.Close()

	etag := quoteETag(hash)
	h := w.Header()
	h.Set(headerETag, etag)
	h.Set(headerCacheControl, chunkCacheControl)
	if etagMatchesAny(r.Header.Get(headerIfNoneMatch), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set(headerContentType, contentTypeOctetStream)
	h.Set(headerContentLength, strconv.FormatInt(size, 10))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	if _, err := copyPooled(w, rc); err != nil {
		logStreamAbort(r, err)
	}
}

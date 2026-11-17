package gateway

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	lumavaultv1 "github.com/lumavault/lumavault/gen/go/lumavault/v1"
	"github.com/lumavault/lumavault/pkg/chunkstore"
	"github.com/lumavault/lumavault/pkg/metadata"
)

// stream serves GET and HEAD /v1/stream/{object_id} as one byte sequence across the
// object's chunks, with single-range 206 support for video players. download=1 in the
// query adds Content-Disposition attachment so browsers save the object instead of playing it.
func (g *gateway) stream(w http.ResponseWriter, r *http.Request) {
	cred, ok := g.httpCredential(w, r)
	if !ok {
		return
	}
	if !cred.readsObject(r.PathValue(paramObjectID)) {
		writeAuthError(w, denied("this object"))
		return
	}
	obj, err := g.meta.GetObject(r.Context(), r.PathValue(paramObjectID))
	if err != nil {
		switch {
		case errors.Is(err, metadata.ErrObjectNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		case errors.Is(err, metadata.ErrInvalidArgument):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeInternalError(w, r, err)
		}
		return
	}

	size := int64(obj.GetSizeBytes())
	etag := quoteETag(obj.GetSha256Digest())
	h := w.Header()
	h.Set(headerAcceptRanges, rangeUnitBytes)
	h.Set(headerETag, etag)
	if etagMatchesAny(r.Header.Get(headerIfNoneMatch), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	contentType := obj.GetMimeType()
	if contentType == "" {
		contentType = contentTypeOctetStream
	}
	h.Set(headerContentType, contentType)

	status := http.StatusOK
	br := byteRange{start: 0, end: size - 1}
	if rangeHeader := r.Header.Get(headerRange); rangeHeader != "" && ifRangeAllowsRange(r.Header.Get(headerIfRange), etag) {
		br, err = parseRange(rangeHeader, size)
		if err != nil {
			h.Del(headerContentType)
			h.Set(headerContentRange, fmt.Sprintf(contentRangeNone, size))
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		status = http.StatusPartialContent
	}

	// Content headers are set only once the response is known to succeed, so error
	// bodies never carry a stale Content-Length or Content-Range.
	setContentHeaders := func() {
		if wantsDownload(r) {
			h.Set(headerContentDisposition, attachmentDisposition(obj.GetFilename()))
		}
		h.Set(headerContentLength, strconv.FormatInt(max(br.length(), 0), 10))
		if status == http.StatusPartialContent {
			h.Set(headerContentRange, fmt.Sprintf(contentRangeFull, br.start, br.end, size))
		}
	}
	if size == 0 || r.Method == http.MethodHead {
		setContentHeaders()
		w.WriteHeader(status)
		return
	}

	plan := planChunkReads(obj, br)
	// Open the first chunk before sending the status so a missing chunk still gets a clean error.
	first, err := g.openChunkRead(r, plan[0])
	if err != nil {
		if errors.Is(err, chunkstore.ErrChunkNotFound) {
			writeError(w, http.StatusInternalServerError, "object chunk missing from storage")
			return
		}
		writeInternalError(w, r, err)
		return
	}
	setContentHeaders()
	w.WriteHeader(status)

	for i, read := range plan {
		rc := first
		if i > 0 {
			if rc, err = g.openChunkRead(r, read); err != nil {
				logStreamAbort(r, err)
				return
			}
		}
		n, err := copyPooled(w, io.LimitReader(rc, read.length))
		_ = rc.Close()
		if err == nil && n != read.length {
			err = fmt.Errorf("chunk %s: %w", read.hash, io.ErrUnexpectedEOF)
		}
		if err != nil {
			logStreamAbort(r, err)
			return
		}
	}
}

// chunkRead is the slice of one chunk needed to serve part of a range.
type chunkRead struct {
	hash     string
	offset   int64
	length   int64
	chunkLen int64
}

// planChunkReads maps an inclusive object byte range to per-chunk reads using
// offset / chunk_size_bytes, with no disk access.
func planChunkReads(obj *lumavaultv1.ObjectMetadata, br byteRange) []chunkRead {
	chunkSize := int64(obj.GetChunkSizeBytes())
	size := int64(obj.GetSizeBytes())
	hashes := obj.GetChunkHashes()
	startIdx, endIdx := br.start/chunkSize, br.end/chunkSize

	reads := make([]chunkRead, 0, endIdx-startIdx+1)
	for idx := startIdx; idx <= endIdx; idx++ {
		chunkStart := idx * chunkSize
		chunkLen := min(chunkSize, size-chunkStart)
		from := max(br.start, chunkStart) - chunkStart
		to := min(br.end, chunkStart+chunkLen-1) - chunkStart
		reads = append(reads, chunkRead{hash: hashes[idx], offset: from, length: to - from + 1, chunkLen: chunkLen})
	}
	return reads
}

// openChunkRead opens a whole chunk when the read covers it, otherwise a sub-range.
func (g *gateway) openChunkRead(r *http.Request, read chunkRead) (io.ReadCloser, error) {
	if read.offset == 0 && read.length == read.chunkLen {
		rc, _, err := g.chunks.GetChunk(r.Context(), read.hash)
		return rc, err
	}
	return g.chunks.ReadChunkRange(r.Context(), read.hash, read.offset, read.length)
}

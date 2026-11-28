package gateway

import (
	"io"
	"sync"

	"github.com/lumavault/lumavault/core/internal/constants"
)

// copyBufPool shares 32 KiB buffers across data plane streams so each active stream
// costs about one buffer of heap.
var copyBufPool = sync.Pool{
	New: func() any {
		b := make([]byte, constants.StreamBufferSize)
		return &b
	},
}

// copyPooled copies src to dst through a pooled buffer.
func copyPooled(dst io.Writer, src io.Reader) (int64, error) {
	bp := copyBufPool.Get().(*[]byte)
	defer copyBufPool.Put(bp)
	return io.CopyBuffer(dst, src, *bp)
}

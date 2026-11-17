package gateway

const (
	// controlPlaneReadMaxBytes caps a single Connect-RPC request message at 1 MiB.
	controlPlaneReadMaxBytes = 1 << 20

	contentTypeJSON        = "application/json"
	contentTypeOctetStream = "application/octet-stream"

	// chunkCacheControl lets clients and proxies cache chunks forever, since a chunk's
	// bytes can never change under its SHA-256 name.
	chunkCacheControl = "public, max-age=31536000, immutable"

	corsAllowOrigin  = "*"
	corsAllowMethods = "GET, HEAD, POST, PUT, OPTIONS"
	corsAllowHeaders = "Authorization, Range, If-Range, If-None-Match, Content-Type, Connect-Protocol-Version, " +
		"Connect-Timeout-Ms, Connect-Accept-Encoding, Grpc-Timeout, X-Grpc-Web"
	corsExposeHeaders = "Content-Range, Accept-Ranges, Content-Length, ETag, " +
		"Connect-Content-Encoding, Grpc-Status, Grpc-Message"
)

// Routes and the path parameters their handlers read. Keep each pair in sync.
const (
	routePutChunk = "PUT /v1/chunks/{sha256}"
	routeGetChunk = "GET /v1/chunks/{sha256}"
	routeStream   = "GET /v1/stream/{object_id}"
	routeHealthz  = "GET /healthz"

	paramSHA256   = "sha256"
	paramObjectID = "object_id"
)

// The stream route answers as a browser download only when the query has download=1.
const (
	queryDownload   = "download"
	queryDownloadOn = "1"

	dispositionAttachment = "attachment"
	dispositionFilename   = "filename"
)

// HTTP header names used by the data plane and CORS middleware.
const (
	headerAcceptRanges       = "Accept-Ranges"
	headerCacheControl       = "Cache-Control"
	headerContentDisposition = "Content-Disposition"
	headerContentLength      = "Content-Length"
	headerContentRange       = "Content-Range"
	headerContentType        = "Content-Type"
	headerETag               = "ETag"
	headerIfNoneMatch        = "If-None-Match"
	headerIfRange            = "If-Range"
	headerRange              = "Range"
	headerCORSAllowOrigin    = "Access-Control-Allow-Origin"
	headerCORSAllowMethods   = "Access-Control-Allow-Methods"
	headerCORSAllowHeaders   = "Access-Control-Allow-Headers"
	headerCORSExposeHeaders  = "Access-Control-Expose-Headers"
)

// Byte-range tokens from RFC 9110.
const (
	rangeUnitBytes   = "bytes"
	rangeSpecPrefix  = rangeUnitBytes + "="
	contentRangeFull = rangeUnitBytes + " %d-%d/%d"
	contentRangeNone = rangeUnitBytes + " */%d"
)

// Storage ticket credentials. Clients send a ticket as a Bearer token; apps/api sends the
// service key in its own header.
const (
	headerAuthorization = "Authorization"
	headerServiceKey    = "X-LumaVault-Service-Key"
	bearerScheme        = "bearer"

	// queryToken carries a ticket on GET URLs for video and image elements that cannot set headers.
	queryToken = "token"
)

import Connect
import Foundation
import SwiftProtobuf

/// One client per gateway. Create it once and use it for every storage call.
public final class LumaVaultClient: Sendable {
    private let baseURL: URL
    private let rpc: Lumavault_V1_StorageServiceClient
    private let dataPlane: DataPlane

    public convenience init(baseURL: URL) {
        self.init(baseURL: baseURL, sessionConfiguration: .default)
    }

    init(baseURL: URL, sessionConfiguration: URLSessionConfiguration) {
        self.baseURL = baseURL
        self.rpc = Lumavault_V1_StorageServiceClient(
            client: ProtocolClient(
                httpClient: URLSessionHTTPClient(configuration: sessionConfiguration),
                config: ProtocolClientConfig(host: baseURL.absoluteString, networkProtocol: .connect, codec: ProtoCodec())
            )
        )
        self.dataPlane = DataPlane(baseURL: baseURL, session: URLSession(configuration: sessionConfiguration))
    }

    /// Chunks, hashes, sends only missing chunks, and commits. Empty files are rejected.
    /// The filename defaults to the file's name and the MIME type to one guessed from its extension.
    public func upload(
        fileURL: URL,
        namespace: Namespace,
        filename: String? = nil,
        mimeType: String? = nil,
        concurrency: Int? = nil,
        ticket: String? = nil,
        progress: (@Sendable (UploadProgress) -> Void)? = nil
    ) async throws -> ObjectMetadata {
        try await uploadFile(
            rpc: rpc, dataPlane: dataPlane, fileURL: fileURL, namespace: namespace,
            filename: filename, mimeType: mimeType, concurrency: concurrency ?? defaultUploadConcurrency,
            ticket: ticket, progress: progress
        )
    }

    /// Writes the object to destination, failing with dataLoss if any chunk or the whole file mismatches.
    /// Pass the object's read ticket when the gateway checks tickets.
    public func download(objectID: String, to destination: URL, ticket: String? = nil) async throws {
        let object = try await get(objectID: objectID, ticket: ticket)
        try await downloadVerified(object: object, dataPlane: dataPlane, to: destination, ticket: ticket)
    }

    /// A URL for AVPlayer and other byte-range readers. Not hash-checked.
    public func streamURL(objectID: String, ticket: String? = nil) -> URL {
        gatewayStreamURL(baseURL: baseURL, objectID: objectID, ticket: ticket)
    }

    /// A URL for one chunk, for example to show it in an image view.
    public func chunkURL(sha256: String, ticket: String? = nil) -> URL {
        gatewayChunkURL(baseURL: baseURL, sha256: sha256, ticket: ticket)
    }

    /// The object's thumbnail URL, or nil when it has none.
    public func thumbnailURL(object: ObjectMetadata, ticket: String? = nil) -> URL? {
        object.thumbnailChunkHash.isEmpty ? nil : chunkURL(sha256: object.thumbnailChunkHash, ticket: ticket)
    }

    public func get(objectID: String, ticket: String? = nil) async throws -> ObjectMetadata {
        var request = Lumavault_V1_GetObjectRequest()
        request.objectID = objectID
        return try await rpc.getObject(request: request, headers: TicketAuth.rpcHeaders(ticket: ticket)).unwrap().object
    }

    /// Changes only the fields passed; the gateway's FieldMask is built from them.
    public func update(
        objectID: String,
        filename: String? = nil,
        mimeType: String? = nil,
        thumbnailChunkHash: String? = nil
    ) async throws -> ObjectMetadata {
        var object = ObjectMetadata()
        object.id = objectID
        var paths: [String] = []
        if let filename { object.filename = filename; paths.append("filename") }
        if let mimeType { object.mimeType = mimeType; paths.append("mime_type") }
        if let thumbnailChunkHash { object.thumbnailChunkHash = thumbnailChunkHash; paths.append("thumbnail_chunk_hash") }

        var request = Lumavault_V1_UpdateObjectMetadataRequest()
        request.object = object
        request.updateMask = Google_Protobuf_FieldMask(protoPaths: paths)
        return try await rpc.updateObjectMetadata(request: request).unwrap().object
    }

    public func delete(objectID: String) async throws {
        var request = Lumavault_V1_DeleteObjectRequest()
        request.objectID = objectID
        _ = try await rpc.deleteObject(request: request).unwrap()
    }

    /// One page of objects in a namespace.
    public func list(namespace: Namespace, cursor: String? = nil, limit: Int32? = nil) async throws -> ListPage {
        var request = Lumavault_V1_ListObjectsRequest()
        request.namespace = namespace
        request.pageToken = cursor ?? ""
        request.pageSize = limit ?? 0
        let response = try await rpc.listObjects(request: request).unwrap()
        let hasMore = !response.nextPageToken.isEmpty
        return ListPage(objects: response.objects, cursor: hasMore ? response.nextPageToken : nil, hasMore: hasMore)
    }

    /// Every object in a namespace, fetching pages as the loop asks for them.
    public func listAll(namespace: Namespace, limit: Int32? = nil) -> AsyncThrowingStream<ObjectMetadata, Error> {
        let pages = PageWalker()
        return AsyncThrowingStream {
            while pages.buffered.isEmpty && !pages.done {
                let page = try await self.list(namespace: namespace, cursor: pages.cursor, limit: limit)
                pages.buffered = page.objects
                pages.cursor = page.cursor
                pages.done = !page.hasMore
            }
            return pages.buffered.isEmpty ? nil : pages.buffered.removeFirst()
        }
    }
}

/// Paging state for listAll. AsyncThrowingStream calls its closure one at a time, so the
/// state is never touched concurrently.
private final class PageWalker: @unchecked Sendable {
    var cursor: String?
    var buffered: [ObjectMetadata] = []
    var done = false
}

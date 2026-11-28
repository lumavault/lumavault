import Connect
import Foundation

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
    ) async throws -> UploadResult {
        let object = try await uploadFile(
            rpc: rpc, dataPlane: dataPlane, fileURL: fileURL, namespace: namespace,
            filename: filename, mimeType: mimeType, concurrency: concurrency ?? defaultUploadConcurrency,
            ticket: ticket, progress: progress
        )
        return UploadResult(object: object, url: streamURL(objectID: object.id))
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
}

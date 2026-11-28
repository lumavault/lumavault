import Connect
import Foundation

/// The gateway's raw chunk routes.
struct DataPlane: Sendable {
    let baseURL: URL
    let session: URLSession

    /// Uploads bytes [offset, offset+length) of a file as one chunk. The range is copied to a
    /// temporary file in small pieces and sent from disk, so a 64 MiB chunk never sits in memory.
    func putChunk(sha256: String, file: URL, offset: UInt64, length: Int, ticket: String?) async throws {
        let staged = try stageRange(of: file, offset: offset, length: length)
        defer { try? FileManager.default.removeItem(at: staged) }

        var request = URLRequest(url: gatewayChunkURL(baseURL: baseURL, sha256: sha256))
        request.httpMethod = "PUT"
        TicketAuth.apply(ticket: ticket, to: &request)
        let (body, response) = try await send { try await session.upload(for: request, fromFile: staged) }
        try check(response, body)

        struct Stored: Decodable { let size_bytes: Int }
        let stored = try? JSONDecoder().decode(Stored.self, from: body)
        guard stored?.size_bytes == length else {
            throw ConnectError(code: .internalError, message: "gateway stored a different size for chunk \(sha256)")
        }
    }

    /// Downloads one whole chunk. The caller verifies its hash.
    func getChunk(sha256: String, ticket: String?) async throws -> Data {
        var request = URLRequest(url: gatewayChunkURL(baseURL: baseURL, sha256: sha256))
        TicketAuth.apply(ticket: ticket, to: &request)
        let (body, response) = try await send { try await session.data(for: request) }
        try check(response, body)
        return body
    }

    private func send(_ call: () async throws -> (Data, URLResponse)) async throws -> (Data, URLResponse) {
        do {
            return try await call()
        } catch {
            throw networkError(error)
        }
    }

    private func check(_ response: URLResponse, _ body: Data) throws {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw dataPlaneError(status: status, body: body)
        }
    }
}

func gatewayChunkURL(baseURL: URL, sha256: String, ticket: String? = nil) -> URL {
    withTicket(baseURL.appending(path: GatewayRoutes.chunks).appending(path: sha256), ticket)
}

func gatewayStreamURL(baseURL: URL, objectID: String, ticket: String? = nil) -> URL {
    withTicket(baseURL.appending(path: GatewayRoutes.stream).appending(component: objectID), ticket)
}

// AVPlayer and image views cannot send headers, so their URLs carry the ticket instead.
private func withTicket(_ url: URL, _ ticket: String?) -> URL {
    guard let ticket else { return url }
    return url.appending(queryItems: [URLQueryItem(name: TicketAuth.tokenQueryItem, value: ticket)])
}

/// Copies a byte range of a file into a new temporary file using a small fixed buffer.
func stageRange(of file: URL, offset: UInt64, length: Int) throws -> URL {
    let staged = FileManager.default.temporaryDirectory
        .appending(component: "lumavault-chunk-\(UUID().uuidString)")
    FileManager.default.createFile(atPath: staged.path, contents: nil)
    let reader = try FileHandle(forReadingFrom: file)
    let writer = try FileHandle(forWritingTo: staged)
    defer {
        try? reader.close()
        try? writer.close()
    }
    try reader.seek(toOffset: offset)
    var remaining = length
    while remaining > 0 {
        guard let piece = try reader.read(upToCount: min(remaining, ChunkingConstants.readBufferBytes)),
              !piece.isEmpty
        else {
            throw ConnectError(code: .dataLoss, message: "file changed size while uploading")
        }
        try writer.write(contentsOf: piece)
        remaining -= piece.count
    }
    return staged
}

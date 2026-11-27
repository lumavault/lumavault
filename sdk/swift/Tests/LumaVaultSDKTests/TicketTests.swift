import Connect
import CryptoKit
import Foundation
import Testing

@testable import LumaVaultSDK

/// Mints tickets the way apps/api does, valid for an hour. Tests only.
enum TestTickets {
    static let secret = "swift-test-ticket-secret-0123456789abcdef"
    static let env = ["LUMAVAULT_TICKET_SECRET": secret, "LUMAVAULT_SERVICE_KEY": "swift-test-service-key"]

    static func upload(namespace: Namespace, max: Int) -> String {
        mint(#""k":"up","exp":\#(expiry()),"ns":\#(namespace.rawValue),"max":\#(max)"#)
    }

    static func read(objectID: String) -> String {
        mint(#""k":"rd","exp":\#(expiry()),"obj":"\#(objectID)""#)
    }

    static func read(chunk: String) -> String {
        mint(#""k":"rd","exp":\#(expiry()),"chk":"\#(chunk)""#)
    }

    private static func expiry() -> Int { Int(Date().timeIntervalSince1970) + 3600 }

    private static func mint(_ fields: String) -> String {
        let body = base64url(Data("{\(fields)}".utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: Data("v1.\(body)".utf8), using: SymmetricKey(data: Data(secret.utf8)))
        return "v1.\(body).\(base64url(Data(mac)))"
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

@Suite final class TicketTests {
    let gateway: TestGateway
    let client: LumaVaultClient
    let bytes = ChunkVectors.patternBytes(count: 5 * 1024 * 1024)

    init() async throws {
        gateway = try await TestGateway(env: TestTickets.env)
        client = LumaVaultClient(baseURL: gateway.baseURL)
    }

    private func tempFile() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appending(component: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appending(component: "clip.mp4")
        try bytes.write(to: url)
        return url
    }

    private func upload() async throws -> ObjectMetadata {
        let ticket = TestTickets.upload(namespace: .cinema, max: bytes.count)
        return try await client.upload(fileURL: tempFile(), namespace: .cinema, ticket: ticket)
    }

    @Test func rejectsCallsWithoutATicket() async throws {
        let upload = await #expect(throws: ConnectError.self) {
            try await self.client.upload(fileURL: self.tempFile(), namespace: .cinema)
        }
        #expect(upload?.code == .unauthenticated)
        let get = await #expect(throws: ConnectError.self) { try await self.client.get(objectID: "anything") }
        #expect(get?.code == .unauthenticated)
    }

    @Test func uploadsThenDownloadsAndStreamsWithReadTicket() async throws {
        let object = try await upload()
        let read = TestTickets.read(objectID: object.id)

        #expect(try await client.get(objectID: object.id, ticket: read).id == object.id)
        let destination = FileManager.default.temporaryDirectory.appending(component: UUID().uuidString)
        try await client.download(objectID: object.id, to: destination, ticket: read)
        #expect(try Data(contentsOf: destination) == bytes)

        var request = URLRequest(url: client.streamURL(objectID: object.id, ticket: read))
        request.setValue("bytes=10-19", forHTTPHeaderField: "Range")
        let (body, response) = try await URLSession.shared.data(for: request)
        #expect((response as? HTTPURLResponse)?.statusCode == 206)
        #expect(body == bytes.subdata(in: 10..<20))

        let (_, chunk) = try await URLSession.shared.data(from: client.chunkURL(sha256: object.chunkHashes[0], ticket: read))
        #expect((chunk as? HTTPURLResponse)?.statusCode == 200)
    }

    @Test func mapsTicketsOutsideTheirScopeToPermissionDenied() async throws {
        let object = try await upload()
        let other = await #expect(throws: ConnectError.self) {
            try await self.client.get(objectID: object.id, ticket: TestTickets.read(objectID: "another-object"))
        }
        #expect(other?.code == .permissionDenied)

        let destination = FileManager.default.temporaryDirectory.appending(component: UUID().uuidString)
        let thumb = await #expect(throws: ConnectError.self) {
            try await self.client.download(objectID: object.id, to: destination, ticket: TestTickets.read(chunk: object.chunkHashes[0]))
        }
        #expect(thumb?.code == .permissionDenied)
    }

    @Test func buildsThumbnailURLOnlyWhenThereIsOne() {
        var object = ObjectMetadata()
        #expect(client.thumbnailURL(object: object) == nil)
        object.thumbnailChunkHash = "ab"
        let url = client.thumbnailURL(object: object, ticket: "t k")
        #expect(url?.absoluteString == "\(gateway.baseURL.absoluteString)/v1/chunks/ab?token=t%20k")
    }
}

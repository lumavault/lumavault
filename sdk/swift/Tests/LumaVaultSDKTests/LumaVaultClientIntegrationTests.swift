import Connect
import Foundation
import Testing

@testable import LumaVaultSDK

/// Collects progress events from the upload's concurrent callbacks.
private final class ProgressLog: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [UploadProgress] = []
    func append(_ event: UploadProgress) { lock.withLock { events.append(event) } }
    var all: [UploadProgress] { lock.withLock { events } }
}

@Suite final class LumaVaultClientIntegrationTests {
    let gateway: TestGateway
    let client: LumaVaultClient
    let mib = 1024 * 1024

    init() async throws {
        gateway = try await TestGateway()
        client = LumaVaultClient(baseURL: gateway.baseURL)
    }

    private func tempFile(named name: String, bytes: Data) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appending(component: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appending(component: name)
        try bytes.write(to: url)
        return url
    }

    @Test func uploadsAndDownloadsIdenticalBytesWithProgress() async throws {
        let bytes = ChunkVectors.patternBytes(count: 9 * mib)
        let file = try tempFile(named: "movie.mp4", bytes: bytes)
        let log = ProgressLog()

        let result = try await client.upload(fileURL: file, namespace: .cinema, progress: { log.append($0) })
        #expect(result.object.filename == "movie.mp4")
        #expect(result.object.mimeType == "video/mp4")
        #expect(result.object.chunkHashes.count == 3)
        #expect(result.url == client.streamURL(objectID: result.object.id))
        #expect(log.all.first?.phase == .hashing)
        #expect(log.all.last == UploadProgress(phase: .uploading, loaded: UInt64(9 * mib), total: UInt64(9 * mib)))

        let destination = file.deletingLastPathComponent().appending(component: "copy.mp4")
        try await client.download(objectID: result.object.id, to: destination)
        #expect(try Data(contentsOf: destination) == bytes)
    }

    @Test func reuploadSendsNoChunksAndCreatesNewObject() async throws {
        let file = try tempFile(named: "a.jpg", bytes: ChunkVectors.patternBytes(count: 5 * mib))
        let first = try await client.upload(fileURL: file, namespace: .photos)

        let log = ProgressLog()
        let second = try await client.upload(fileURL: file, namespace: .photos, progress: { log.append($0) })
        let uploading = log.all.filter { $0.phase == .uploading }

        // Every chunk PUT reports one event, so a single event already at 100 percent means none were sent.
        #expect(uploading.count == 1)
        #expect(uploading.first?.percentage == 100)
        #expect(second.object.id != first.object.id)
    }

    @Test func getsObjectAndReturnsNotFoundForMissing() async throws {
        let file = try tempFile(named: "save1.sav", bytes: ChunkVectors.patternBytes(count: 101))
        let uploaded = try await client.upload(fileURL: file, namespace: .games).object

        let fetched = try await client.get(objectID: uploaded.id)
        #expect(fetched.id == uploaded.id)
        #expect(fetched.filename == "save1.sav")

        let error = await #expect(throws: ConnectError.self) { try await self.client.get(objectID: "missing-object-id") }
        #expect(error?.code == .notFound)
    }
}

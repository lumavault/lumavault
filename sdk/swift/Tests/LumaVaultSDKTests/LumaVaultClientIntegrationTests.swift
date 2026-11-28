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

        let object = try await client.upload(fileURL: file, namespace: .cinema, progress: { log.append($0) })
        #expect(object.filename == "movie.mp4")
        #expect(object.mimeType == "video/mp4")
        #expect(object.chunkHashes.count == 3)
        #expect(log.all.first?.phase == .hashing)
        #expect(log.all.last == UploadProgress(phase: .uploading, loaded: UInt64(9 * mib), total: UInt64(9 * mib)))

        let destination = file.deletingLastPathComponent().appending(component: "copy.mp4")
        try await client.download(objectID: object.id, to: destination)
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
        #expect(second.id != first.id)
    }

    @Test func getsUpdatesListsAndDeletes() async throws {
        var ids: [String] = []
        for n in 1...3 {
            let file = try tempFile(named: "save\(n).sav", bytes: ChunkVectors.patternBytes(count: 100 + n))
            ids.append(try await client.upload(fileURL: file, namespace: .games).id)
        }

        let updated = try await client.update(objectID: ids[0], filename: "renamed.sav")
        #expect(updated.filename == "renamed.sav")
        #expect(try await client.get(objectID: ids[0]).filename == "renamed.sav")

        let page = try await client.list(namespace: .games, limit: 2)
        #expect(page.objects.count == 2)
        #expect(page.hasMore)

        var all: [String] = []
        for try await object in client.listAll(namespace: .games, limit: 2) { all.append(object.id) }
        #expect(Set(ids).isSubset(of: Set(all)))

        try await client.delete(objectID: ids[1])
        let error = await #expect(throws: ConnectError.self) { try await self.client.get(objectID: ids[1]) }
        #expect(error?.code == .notFound)
    }
}

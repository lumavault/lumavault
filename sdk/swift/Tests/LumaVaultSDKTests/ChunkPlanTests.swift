import Connect
import Foundation
import Testing

@testable import LumaVaultSDK

@Suite struct ChunkPlanTests {
    @Test(arguments: ChunkVectors.shared.chunkSizeRule.map { ($0.sizeBytes, $0.chunkSizeBytes) })
    func chunkSizeMatchesSharedRule(sizeBytes: UInt64, expected: Int) {
        #expect(chunkSize(forFileSize: sizeBytes) == expected)
    }

    @Test(arguments: ChunkVectors.shared.files)
    func planMatchesSharedVector(_ vector: ChunkVectors.FileVector) throws {
        let url = try writeTempFile(ChunkVectors.patternBytes(count: vector.sizeBytes))
        defer { try? FileManager.default.removeItem(at: url) }

        let plan = try planChunks(fileURL: url)

        #expect(plan.sizeBytes == UInt64(vector.sizeBytes))
        #expect(plan.chunkSizeBytes == vector.chunkSizeBytes)
        #expect(plan.sha256Digest == vector.sha256)
        #expect(plan.chunkHashes == vector.chunkHashes)
    }

    @Test func emptyFileIsRejected() throws {
        let url = try writeTempFile(Data())
        defer { try? FileManager.default.removeItem(at: url) }

        let error = #expect(throws: ConnectError.self) { try planChunks(fileURL: url) }
        #expect(error?.code == .invalidArgument)
    }

    @Test func stopsBeforeHashingWhenTaskIsAlreadyCancelled() async throws {
        let url = try writeTempFile(Data(count: 2 * ChunkingConstants.minChunkSizeBytes + 1))
        defer { try? FileManager.default.removeItem(at: url) }

        let task = Task { () throws -> Int in
            withUnsafeCurrentTask { $0?.cancel() }
            var hashedCallbacks = 0
            do {
                _ = try planChunks(fileURL: url) { _, _ in hashedCallbacks += 1 }
                Issue.record("expected planChunks to throw CancellationError")
            } catch is CancellationError {
                return hashedCallbacks
            }
            return hashedCallbacks
        }

        #expect(try await task.value == 0)
    }

    @Test func stopsBetweenChunksWhenCancelledDuringHashing() async throws {
        let url = try writeTempFile(Data(count: 3 * ChunkingConstants.minChunkSizeBytes + 1))
        defer { try? FileManager.default.removeItem(at: url) }

        let task = Task { () throws -> Int in
            var hashedCallbacks = 0
            do {
                _ = try planChunks(fileURL: url) { _, _ in
                    hashedCallbacks += 1
                    withUnsafeCurrentTask { $0?.cancel() }
                }
                Issue.record("expected planChunks to throw CancellationError")
            } catch is CancellationError {
                return hashedCallbacks
            }
            return hashedCallbacks
        }

        #expect(try await task.value == 1)
    }

    private func writeTempFile(_ data: Data) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("lumavault-chunk-\(UUID().uuidString)")
        try data.write(to: url)
        return url
    }
}

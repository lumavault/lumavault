import Connect
import CryptoKit
import Foundation

/// The manifest fields CommitObject needs, computed locally before any network call.
struct ChunkPlan: Equatable, Sendable {
    let sizeBytes: UInt64
    let chunkSizeBytes: Int
    /// Lowercase hex SHA-256 of the whole file.
    let sha256Digest: String
    /// Lowercase hex SHA-256 of each chunk, in order.
    let chunkHashes: [String]
}

/// Picks the chunk size for a file: start at 4 MiB and double until the file fits in at most
/// 256 chunks, capped at 64 MiB. Deterministic so the same file always yields the same chunks.
func chunkSize(forFileSize sizeBytes: UInt64) -> Int {
    var size = ChunkingConstants.minChunkSizeBytes
    while size < ChunkingConstants.maxChunkSizeBytes
        && UInt64(size) * UInt64(ChunkingConstants.targetMaxChunks) < sizeBytes
    {
        size *= 2
    }
    return size
}

/// Splits the file into chunks and hashes each chunk and the whole file in one pass.
/// The file is read in small pieces, so memory stays flat even for multi-gigabyte files.
func planChunks(
    fileURL: URL,
    onHashed: ((_ hashedBytes: UInt64, _ totalBytes: UInt64) -> Void)? = nil
) throws -> ChunkPlan {
    let handle = try FileHandle(forReadingFrom: fileURL)
    defer { try? handle.close() }

    let sizeBytes = try handle.seekToEnd()
    guard sizeBytes > 0 else {
        throw ConnectError(code: .invalidArgument, message: "empty files cannot be uploaded")
    }
    try handle.seek(toOffset: 0)

    let chunkSizeBytes = chunkSize(forFileSize: sizeBytes)
    var fileHasher = SHA256()
    var chunkHasher = SHA256()
    var chunkHashes: [String] = []
    var bytesInChunk = 0
    var hashedBytes: UInt64 = 0

    while true {
        let wanted = min(ChunkingConstants.readBufferBytes, chunkSizeBytes - bytesInChunk)
        guard let piece = try handle.read(upToCount: wanted), !piece.isEmpty else { break }
        fileHasher.update(data: piece)
        chunkHasher.update(data: piece)
        bytesInChunk += piece.count
        hashedBytes += UInt64(piece.count)
        if bytesInChunk == chunkSizeBytes {
            chunkHashes.append(chunkHasher.finalize().lowercaseHex)
            chunkHasher = SHA256()
            bytesInChunk = 0
            onHashed?(hashedBytes, sizeBytes)
        }
    }
    if bytesInChunk > 0 {
        chunkHashes.append(chunkHasher.finalize().lowercaseHex)
        onHashed?(hashedBytes, sizeBytes)
    }

    return ChunkPlan(
        sizeBytes: sizeBytes,
        chunkSizeBytes: chunkSizeBytes,
        sha256Digest: fileHasher.finalize().lowercaseHex,
        chunkHashes: chunkHashes
    )
}

extension Sequence where Element == UInt8 {
    /// Lowercase hex, the form the gateway uses for SHA-256 digests.
    var lowercaseHex: String {
        map { byte in
            let hex = String(byte, radix: 16)
            return byte < 16 ? "0" + hex : hex
        }.joined()
    }
}

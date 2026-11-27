import Foundation

/// A committed object's manifest, as stored by the gateway.
public typealias ObjectMetadata = Lumavault_V1_ObjectMetadata

/// Which app an object belongs to.
public typealias Namespace = Lumavault_V1_Namespace

public struct UploadProgress: Sendable, Equatable {
    /// Hashing runs over the whole file first, then missing chunks are uploaded.
    public enum Phase: Sendable, Equatable {
        case hashing
        case uploading
    }

    public let phase: Phase
    public let loaded: UInt64
    public let total: UInt64
    /// loaded / total as a number from 0 to 100.
    public let percentage: Double

    init(phase: Phase, loaded: UInt64, total: UInt64) {
        self.phase = phase
        self.loaded = loaded
        self.total = total
        self.percentage = total == 0 ? 100 : Double(loaded) / Double(total) * 100
    }
}

public struct ListPage: Sendable {
    public let objects: [ObjectMetadata]
    /// Pass to the next list call. Nil on the last page.
    public let cursor: String?
    public let hasMore: Bool
}

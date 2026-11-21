import Foundation

/// Builds core/cmd/lumavault once and runs a fresh instance per test on a random port.
final class TestGateway {
    let baseURL: URL
    private let process: Process
    private let dir: URL

    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    private static let binary: Result<URL, Error> = Result {
        let out = FileManager.default.temporaryDirectory.appending(component: "lumavault-swift-test-\(UUID().uuidString)")
        let build = Process()
        build.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        build.arguments = ["go", "build", "-o", out.path, "./core/cmd/lumavault"]
        build.currentDirectoryURL = repoRoot
        try build.run()
        build.waitUntilExit()
        guard build.terminationStatus == 0 else { throw GatewayError("go build failed") }
        return out
    }

    /// Pass env to turn on storage ticket checks.
    init(env: [String: String] = [:]) async throws {
        dir = FileManager.default.temporaryDirectory.appending(component: "lumavault-gw-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // Logs go to a file, not a pipe, so a chatty server can never block on a full pipe.
        let log = dir.appending(component: "stdout.log")
        FileManager.default.createFile(atPath: log.path, contents: nil)

        process = Process()
        process.executableURL = try Self.binary.get()
        process.arguments = ["-addr", "127.0.0.1:0", "-data-dir", dir.appending(component: "data").path]
        process.standardOutput = try FileHandle(forWritingTo: log)
        process.environment = ProcessInfo.processInfo.environment.merging(env) { _, new in new }
        try process.run()

        do {
            baseURL = try await Self.waitForAddress(in: log)
            try await Self.waitHealthy(baseURL)
        } catch {
            process.terminate()
            throw error
        }
    }

    deinit {
        process.terminate()
        try? FileManager.default.removeItem(at: dir)
    }

    // The server logs a line like: level=INFO msg=listening addr=127.0.0.1:54321 data_dir=...
    private static func waitForAddress(in log: URL) async throws -> URL {
        for _ in 0..<600 {
            let text = (try? String(contentsOf: log, encoding: .utf8)) ?? ""
            if let range = text.range(of: #"msg=listening addr=(\S+)"#, options: .regularExpression) {
                let addr = text[range].replacingOccurrences(of: "msg=listening addr=", with: "")
                return URL(string: "http://\(addr)")!
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw GatewayError("gateway never logged its address")
    }

    private static func waitHealthy(_ baseURL: URL) async throws {
        for _ in 0..<600 {
            if let (_, response) = try? await URLSession.shared.data(from: baseURL.appending(path: "healthz")),
               (response as? HTTPURLResponse)?.statusCode == 200
            {
                return
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw GatewayError("gateway never became healthy")
    }
}

struct GatewayError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

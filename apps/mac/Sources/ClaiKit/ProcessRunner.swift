import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

public struct ProcessOutput: Sendable {
    public var status: Int32
    public var stdout: Data
    public var stderr: Data
    public var timedOut: Bool

    public var stdoutText: String { String(decoding: stdout, as: UTF8.self) }
    public var stderrText: String { String(decoding: stderr, as: UTF8.self) }
}

/// Runs a child process to completion without blocking the caller, reading both pipes
/// concurrently (so a chatty child never stalls on a full pipe) and stopping it after `timeout`.
public enum ProcessRunner {
    public static func run(
        executable: URL,
        arguments: [String],
        environment: [String: String]? = nil,
        currentDirectory: URL? = nil,
        timeout: TimeInterval = 60
    ) async throws -> ProcessOutput {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<ProcessOutput, Error>) in
            let process = Process()
            process.executableURL = executable
            process.arguments = arguments
            if let environment { process.environment = environment }
            if let currentDirectory { process.currentDirectoryURL = currentDirectory }
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe
            process.standardInput = FileHandle.nullDevice

            let collector = OutputCollector()
            collector.read(stdoutPipe.fileHandleForReading, into: \.stdout)
            collector.read(stderrPipe.fileHandleForReading, into: \.stderr)
            process.terminationHandler = { finished in
                collector.finish(status: finished.terminationStatus, continuation: continuation)
            }
            do {
                try process.run()
            } catch {
                process.terminationHandler = nil
                // The readers wait for end of file; closing our write ends delivers it.
                try? stdoutPipe.fileHandleForWriting.close()
                try? stderrPipe.fileHandleForWriting.close()
                continuation.resume(throwing: error)
                return
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                guard process.isRunning else { return }
                collector.markTimedOut()
                stop(process)
            }
        }
    }

    /// SIGTERM, then SIGKILL if the child is still there a moment later. A child can inherit a
    /// blocked SIGTERM from the thread that started it (Swift concurrency threads block signals on
    /// Linux), and SIGKILL cannot be blocked.
    public static func stop(_ process: Process, grace: TimeInterval = 1.5) {
        guard process.isRunning else { return }
        let pid = process.processIdentifier
        process.terminate()
        DispatchQueue.global().asyncAfter(deadline: .now() + grace) {
            if process.isRunning { kill(pid, SIGKILL) }
        }
    }
}

private final class OutputCollector: @unchecked Sendable {
    struct Buffers {
        var stdout = Data()
        var stderr = Data()
        var timedOut = false
    }

    private let lock = NSLock()
    private let group = DispatchGroup()
    private var buffers = Buffers()

    func read(_ handle: FileHandle, into field: WritableKeyPath<Buffers, Data>) {
        group.enter()
        DispatchQueue.global().async {
            let data = handle.readDataToEndOfFile()
            self.lock.lock()
            self.buffers[keyPath: field] = data
            self.lock.unlock()
            self.group.leave()
        }
    }

    func markTimedOut() {
        lock.lock()
        buffers.timedOut = true
        lock.unlock()
    }

    func finish(status: Int32, continuation: CheckedContinuation<ProcessOutput, Error>) {
        DispatchQueue.global().async {
            // The pipes close when the child exits, unless a grandchild inherited them; never wait
            // on such a grandchild for longer than a moment.
            _ = self.group.wait(timeout: .now() + 2)
            self.lock.lock()
            let output = ProcessOutput(status: status, stdout: self.buffers.stdout, stderr: self.buffers.stderr, timedOut: self.buffers.timedOut)
            self.lock.unlock()
            continuation.resume(returning: output)
        }
    }
}

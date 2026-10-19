import Foundation

/// Where the engine lives: the Node runtime and the bundled CLI (scripts/bundle-engine.mjs).
public struct EngineLocation: Equatable, Sendable {
    public var node: URL
    public var script: URL

    public init(node: URL, script: URL) {
        self.node = node
        self.script = script
    }

    /// Inside the app: `Contents/Helpers/node` and `Contents/Resources/engine/clai.mjs`.
    public static func inBundle(_ bundleURL: URL) -> EngineLocation {
        EngineLocation(
            node: bundleURL.appendingPathComponent("Contents/Helpers/node"),
            script: bundleURL.appendingPathComponent("Contents/Resources/engine/clai.mjs")
        )
    }

    /// The bundled engine, or for development `CLAI_ENGINE_SCRIPT` (with `CLAI_ENGINE_NODE` or a
    /// Homebrew/system `node`), e.g. after `npm run bundle:engine` in the repository.
    public static func find(
        bundleURL: URL,
        environment: [String: String],
        fileExists: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) || FileManager.default.fileExists(atPath: $0) }
    ) -> EngineLocation? {
        if let script = environment["CLAI_ENGINE_SCRIPT"], !script.isEmpty {
            let candidates = [environment["CLAI_ENGINE_NODE"]].compactMap { $0 } + ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
            if let node = candidates.first(where: fileExists) {
                return EngineLocation(node: URL(fileURLWithPath: node), script: URL(fileURLWithPath: script))
            }
        }
        let bundled = inBundle(bundleURL)
        if fileExists(bundled.node.path) && fileExists(bundled.script.path) { return bundled }
        return nil
    }
}

public enum EngineError: Error, Equatable, LocalizedError {
    case notFound
    case wrongArchitecture(needs: String)
    case launchFailed(String)
    case failed(status: Int32, message: String)
    case timedOut(seconds: Int)
    case badOutput(String)
    case unsupportedSchema(Int)

    public var errorDescription: String? {
        switch self {
        case .notFound:
            return "The clai engine is missing from this copy of the app. Download clai again from getclai.vercel.app."
        case .wrongArchitecture(let needs):
            return "This download of clai is built for \(needs) Macs. Get the version for this Mac at getclai.vercel.app."
        case .launchFailed(let message):
            return "The clai engine did not start: \(message)"
        case .failed(_, let message):
            return message.isEmpty ? "The clai engine stopped with an error." : message
        case .timedOut(let seconds):
            return "Reading your logs took longer than \(seconds) seconds. clai tries again on the next refresh."
        case .badOutput:
            return "The clai engine returned something this version cannot read."
        case .unsupportedSchema(let schema):
            return "The engine writes snapshot format \(schema), which this version of clai does not know. Update clai."
        }
    }

    /// The last meaningful line of a failed command's stderr, which is where the CLI puts its message.
    public static func summary(of stderr: String) -> String {
        let lines = stderr
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("(node:") && !$0.hasPrefix("(Use `node") }
        guard let last = lines.last else { return "" }
        return last.count > 240 ? String(last.prefix(239)) + "…" : last
    }
}

/// Runs the bundled clai CLI. Every call is one short-lived process; nothing stays resident.
public struct Engine: Sendable {
    public let location: EngineLocation
    public let environment: [String: String]

    public init(location: EngineLocation, environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.location = location
        var env = environment
        env["NO_COLOR"] = "1"
        env["CLAI_NO_MOTION"] = "1"
        env.removeValue(forKey: "FORCE_COLOR")
        env.removeValue(forKey: "NODE_OPTIONS")
        self.environment = env
    }

    public func arguments(for command: [String]) -> [String] {
        ["--disable-warning=ExperimentalWarning", location.script.path] + command
    }

    /// Fails early, with a clear message, when the bundled Node cannot run on this Mac.
    public func checkArchitecture(host: CPUArchitecture = .current) throws {
        let archs = MachO.architectures(ofFile: location.node)
        guard MachO.canRun(archs, on: host) else {
            throw EngineError.wrongArchitecture(needs: archs.contains(.arm64) ? "Apple silicon" : "Intel")
        }
    }

    @discardableResult
    public func run(_ command: [String], timeout: TimeInterval = 60) async throws -> ProcessOutput {
        try checkArchitecture()
        let output: ProcessOutput
        do {
            output = try await ProcessRunner.run(executable: location.node, arguments: arguments(for: command), environment: environment, timeout: timeout)
        } catch {
            throw EngineError.launchFailed(error.localizedDescription)
        }
        if output.timedOut { throw EngineError.timedOut(seconds: Int(timeout)) }
        guard output.status == 0 else {
            throw EngineError.failed(status: output.status, message: EngineError.summary(of: output.stderrText))
        }
        return output
    }

    /// `clai snapshot [--scan]`: read new usage from local logs, then describe everything.
    public func snapshot(scan: Bool = true, timeout: TimeInterval = 180) async throws -> Snapshot {
        let output = try await run(scan ? ["snapshot", "--scan"] : ["snapshot"], timeout: timeout)
        do {
            return try Snapshot.decode(output.stdout)
        } catch let error as EngineError {
            throw error
        } catch {
            throw EngineError.badOutput(String(describing: error))
        }
    }

    /// `clai plan set <provider> <plan>`.
    public func setPlan(provider: String, plan: String) async throws {
        try await run(["plan", "set", provider, plan])
    }

    /// `clai plan remove <id>`.
    public func removePlan(id: String) async throws {
        try await run(["plan", "remove", id])
    }

    /// `clai budget set <name> <amount> --id <id>`.
    public func setBudget(name: String, amountUsd: Double, id: String) async throws {
        try await run(["budget", "set", name, String(format: "%.2f", amountUsd), "--id", id])
    }

    /// `clai budget remove <id>`.
    public func removeBudget(id: String) async throws {
        try await run(["budget", "remove", id])
    }

    /// Arguments for the long-running local dashboard server (the caller owns the process).
    public func dashboardArguments(port: Int) -> [String] {
        arguments(for: ["dashboard", "--no-open", "--no-scan", "--port", String(port)])
    }
}

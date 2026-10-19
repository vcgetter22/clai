import XCTest
@testable import ClaiKit

final class ProcessRunnerTests: XCTestCase {
    private let sh = URL(fileURLWithPath: "/bin/sh")

    func testCollectsStatusAndBothStreams() async throws {
        let out = try await ProcessRunner.run(executable: sh, arguments: ["-c", "echo hi; echo oops >&2; exit 3"])
        XCTAssertEqual(out.status, 3)
        XCTAssertEqual(out.stdoutText, "hi\n")
        XCTAssertEqual(out.stderrText, "oops\n")
        XCTAssertFalse(out.timedOut)
    }

    func testDrainsLargeOutputWithoutStalling() async throws {
        let out = try await ProcessRunner.run(executable: sh, arguments: ["-c", "head -c 300000 /dev/zero | tr '\\\\0' x"])
        XCTAssertEqual(out.status, 0)
        XCTAssertEqual(out.stdout.count, 300_000)
    }

    func testStopsAfterTheTimeout() async throws {
        let started = Date()
        // `exec` so the shell becomes the sleeping process (no grandchild holding the pipes).
        let out = try await ProcessRunner.run(executable: sh, arguments: ["-c", "exec sleep 10"], timeout: 0.5)
        XCTAssertTrue(out.timedOut)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    func testPassesTheEnvironment() async throws {
        let out = try await ProcessRunner.run(executable: sh, arguments: ["-c", "printf %s \"$CLAI_PROBE\""], environment: ["CLAI_PROBE": "bubbles", "PATH": "/usr/bin:/bin"])
        XCTAssertEqual(out.stdoutText, "bubbles")
    }

    func testThrowsWhenTheExecutableIsMissing() async {
        do {
            _ = try await ProcessRunner.run(executable: URL(fileURLWithPath: "/nonexistent/node"), arguments: [])
            XCTFail("expected an error")
        } catch {
            // expected
        }
    }
}

final class MachOTests: XCTestCase {
    private func thin(_ cpu: [UInt8]) -> Data { Data([0xCF, 0xFA, 0xED, 0xFE] + cpu + [0, 0, 0, 0]) }

    func testReadsThinAndUniversalHeaders() {
        XCTAssertEqual(MachO.architectures(ofHeader: thin([0x0C, 0x00, 0x00, 0x01])), [.arm64])
        XCTAssertEqual(MachO.architectures(ofHeader: thin([0x07, 0x00, 0x00, 0x01])), [.x86_64])
        var fat = Data([0xCA, 0xFE, 0xBA, 0xBE, 0, 0, 0, 2])
        fat += Data([0x01, 0x00, 0x00, 0x07]) + Data(count: 16)
        fat += Data([0x01, 0x00, 0x00, 0x0C]) + Data(count: 16)
        XCTAssertEqual(MachO.architectures(ofHeader: fat), [.x86_64, .arm64])
        XCTAssertEqual(MachO.architectures(ofHeader: Data("#!/bin/sh\n".utf8)), [])
        XCTAssertEqual(MachO.architectures(ofHeader: Data([0xCF])), [])
    }

    func testRosettaRunsIntelOnAppleSilicon() {
        XCTAssertTrue(MachO.canRun([.arm64], on: .arm64))
        XCTAssertTrue(MachO.canRun([.x86_64], on: .arm64))
        XCTAssertTrue(MachO.canRun([.x86_64], on: .x86_64))
        XCTAssertFalse(MachO.canRun([.arm64], on: .x86_64))
        XCTAssertTrue(MachO.canRun([], on: .x86_64))
    }
}

final class EngineTests: XCTestCase {
    /// A stand-in for `node`: a shell script that prints `stdout` and exits with `status`.
    private func fakeNode(_ body: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("clai-engine-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("node")
        try ("#!/bin/sh\n" + body + "\n").write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url
    }

    func testSnapshotRunsTheEngineAndDecodes() async throws {
        let node = try fakeNode("cat '\(Fixture.url.path)'")
        let engine = Engine(location: EngineLocation(node: node, script: URL(fileURLWithPath: "/engine/clai.mjs")), environment: [:])
        let snapshot = try await engine.snapshot()
        XCTAssertEqual(snapshot.month.key, "2026-10")
    }

    func testPassesTheCommandAfterTheScript() async throws {
        let node = try fakeNode("echo \"$@\"")
        let engine = Engine(location: EngineLocation(node: node, script: URL(fileURLWithPath: "/engine/clai.mjs")), environment: [:])
        let out = try await engine.run(["plan", "set", "anthropic", "max_5x"])
        XCTAssertEqual(out.stdoutText, "--disable-warning=ExperimentalWarning /engine/clai.mjs plan set anthropic max_5x\n")
    }

    func testReportsTheCliErrorMessage() async throws {
        let node = try fakeNode("echo '(node:42) ExperimentalWarning: SQLite is experimental' >&2; echo 'Unknown plan \"gold\" for anthropic.' >&2; exit 1")
        let engine = Engine(location: EngineLocation(node: node, script: URL(fileURLWithPath: "/engine/clai.mjs")), environment: [:])
        do {
            _ = try await engine.snapshot()
            XCTFail("expected an error")
        } catch let error as EngineError {
            XCTAssertEqual(error, .failed(status: 1, message: "Unknown plan \"gold\" for anthropic."))
            XCTAssertEqual(error.errorDescription, "Unknown plan \"gold\" for anthropic.")
        }
    }

    func testRejectsOutputThatIsNotASnapshot() async throws {
        let node = try fakeNode("echo '{\"hello\": 1}'")
        let engine = Engine(location: EngineLocation(node: node, script: URL(fileURLWithPath: "/engine/clai.mjs")), environment: [:])
        do {
            _ = try await engine.snapshot()
            XCTFail("expected an error")
        } catch let error as EngineError {
            guard case .badOutput = error else { return XCTFail("unexpected \(error)") }
        }
    }

    func testSanitisesTheEnvironment() {
        let engine = Engine(location: EngineLocation(node: URL(fileURLWithPath: "/n"), script: URL(fileURLWithPath: "/s")), environment: ["FORCE_COLOR": "1", "NODE_OPTIONS": "--inspect", "HOME": "/Users/me"])
        XCTAssertEqual(engine.environment["NO_COLOR"], "1")
        XCTAssertEqual(engine.environment["CLAI_NO_MOTION"], "1")
        XCTAssertNil(engine.environment["FORCE_COLOR"])
        XCTAssertNil(engine.environment["NODE_OPTIONS"])
        XCTAssertEqual(engine.environment["HOME"], "/Users/me")
    }

    func testFindsTheBundledEngineOrADevelopmentOverride() {
        let app = URL(fileURLWithPath: "/Applications/clai.app")
        let bundled = EngineLocation.inBundle(app)
        XCTAssertEqual(bundled.node.path, "/Applications/clai.app/Contents/Helpers/node")
        XCTAssertEqual(bundled.script.path, "/Applications/clai.app/Contents/Resources/engine/clai.mjs")
        XCTAssertEqual(EngineLocation.find(bundleURL: app, environment: [:], fileExists: { _ in true }), bundled)
        XCTAssertNil(EngineLocation.find(bundleURL: app, environment: [:], fileExists: { _ in false }))
        let dev = EngineLocation.find(bundleURL: app, environment: ["CLAI_ENGINE_SCRIPT": "/repo/apps/mac/build/engine/clai.mjs"], fileExists: { $0 == "/opt/homebrew/bin/node" })
        XCTAssertEqual(dev?.node.path, "/opt/homebrew/bin/node")
        XCTAssertEqual(dev?.script.path, "/repo/apps/mac/build/engine/clai.mjs")
    }

    func testErrorSummaryKeepsTheLastMeaningfulLine() {
        XCTAssertEqual(EngineError.summary(of: "(node:1) ExperimentalWarning: x\n(Use `node --trace-warnings ...`)\nError: disk full\n\n"), "Error: disk full")
        XCTAssertEqual(EngineError.summary(of: ""), "")
    }
}

final class ReleaseTests: XCTestCase {
    func testParsesVersions() {
        XCTAssertEqual(SemanticVersion("mac-v0.4.1")?.description, "0.4.1")
        XCTAssertEqual(SemanticVersion("v1.2")?.description, "1.2.0")
        XCTAssertEqual(SemanticVersion("0.4.0")?.description, "0.4.0")
        XCTAssertNil(SemanticVersion("latest"))
        XCTAssertLessThan(SemanticVersion("0.4.0")!, SemanticVersion("0.4.1")!)
        XCTAssertLessThan(SemanticVersion("0.9.9")!, SemanticVersion("0.10.0")!)
    }

    func testReadsTheLatestMacRelease() throws {
        let json = #"{"tag_name":"mac-v0.4.2","html_url":"https://github.com/vcgetter22/clai/releases/tag/mac-v0.4.2","draft":false,"prerelease":false}"#
        let release = try XCTUnwrap(LatestRelease.parse(Data(json.utf8)))
        XCTAssertEqual(release.version.description, "0.4.2")
        XCTAssertTrue(release.isNewer(than: "0.4.0"))
        XCTAssertFalse(release.isNewer(than: "0.4.2"))
        XCTAssertNil(LatestRelease.parse(Data(#"{"tag_name":"v0.5.0","html_url":"https://x"}"#.utf8)))
        XCTAssertNil(LatestRelease.parse(Data("not json".utf8)))
    }
}

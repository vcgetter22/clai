import XCTest
@testable import ClaiCore

final class LineReaderTests: XCTestCase {
    private func read(_ path: String, from offset: UInt64 = 0, chunk: Int = 1 << 22) throws -> ([String], UInt64) {
        var out: [String] = []
        let end = try LineReader.read(path, from: offset, chunkSize: chunk) { out.append(String(decoding: $0, as: UTF8.self)) }
        return (out, end)
    }

    func testReadsCompleteLinesAndWaitsForAPartialOne() throws {
        let home = TempHome()
        let path = home.write("a.jsonl", "{\"a\":1}\n{\"b\":2}\n{\"c\":")
        let (first, end) = try read(path)
        XCTAssertEqual(first, ["{\"a\":1}", "{\"b\":2}"])
        XCTAssertEqual(end, 16)
        home.append("a.jsonl", "3}\n{\"d\":4}\n")
        let (second, end2) = try read(path, from: end)
        XCTAssertEqual(second, ["{\"c\":3}", "{\"d\":4}"])
        XCTAssertEqual(end2, FileStamp.of(path)!.size)
        let (third, end3) = try read(path, from: end2)
        XCTAssertEqual(third, [])
        XCTAssertEqual(end3, end2)
    }

    func testAcceptsACompleteLastLineWithoutNewline() throws {
        let home = TempHome()
        let path = home.write("a.jsonl", "{\"a\":1}\r\n{\"b\":2}")
        let (lines, end) = try read(path)
        XCTAssertEqual(lines, ["{\"a\":1}", "{\"b\":2}"])
        XCTAssertEqual(end, FileStamp.of(path)!.size)
    }

    func testLinesLongerThanTheBufferAndManyChunks() throws {
        let home = TempHome()
        let long = "{\"text\":\"" + String(repeating: "x", count: 50_000) + "\"}"
        var text = ""
        for i in 0..<200 { text += i % 50 == 0 ? long + "\n" : "{\"i\":\(i)}\n" }
        let path = home.write("a.jsonl", text)
        let (lines, end) = try read(path, chunk: 4096)
        XCTAssertEqual(lines.count, 200)
        XCTAssertEqual(lines[0], long)
        XCTAssertEqual(lines[1], "{\"i\":1}")
        XCTAssertEqual(lines[199], "{\"i\":199}")
        XCTAssertEqual(end, UInt64(text.utf8.count))
    }

    func testSkipsEmptyLinesAndReportsMissingFiles() throws {
        let home = TempHome()
        let path = home.write("a.jsonl", "\n\n{\"a\":1}\n\n")
        XCTAssertEqual(try read(path).0, ["{\"a\":1}"])
        XCTAssertThrowsError(try read(home.path + "/missing.jsonl"))
    }

    func testByteSearch() {
        let text = "{\"type\":\"assistant\",\"message\":{\"usage\":{}}}"
        text.utf8CString.withUnsafeBytes { raw in
            let bytes = UnsafeRawBufferPointer(rebasing: raw[0..<(raw.count - 1)])
            XCTAssertTrue(JSON.contains(bytes, "\"usage\""))
            XCTAssertTrue(JSON.contains(bytes, "{\"type\""))
            XCTAssertTrue(JSON.contains(bytes, "}}}"))
            XCTAssertFalse(JSON.contains(bytes, "\"usage\":1"))
            XCTAssertFalse(JSON.contains(bytes, "}}}}"))
        }
    }

    func testFindsFilesWithoutFollowingLinks() throws {
        let home = TempHome()
        home.write("root/a/one.jsonl", "{}\n")
        home.write("root/a/b/two.jsonl", "{}\n")
        home.write("root/notes.txt", "")
        home.write("elsewhere/three.jsonl", "{}\n")
        try FileManager.default.createSymbolicLink(atPath: home.path + "/root/link", withDestinationPath: home.path + "/elsewhere")
        try FileManager.default.createSymbolicLink(atPath: home.path + "/root/file.jsonl", withDestinationPath: home.path + "/elsewhere/three.jsonl")
        let found = FileFinder.files(under: home.path + "/root") { $0.hasSuffix(".jsonl") }.map { $0.replacingOccurrences(of: home.path, with: "") }.sorted()
        XCTAssertEqual(found, ["/root/a/b/two.jsonl", "/root/a/one.jsonl"])
        XCTAssertEqual(FileFinder.files(under: home.path + "/nothing") { _ in true }, [])
    }

    func testNeverEntersGuardedFolders() throws {
        let home = TempHome()
        home.write("Documents/claude/projects/p/s.jsonl", "{}\n")
        home.write(".claude/real/s.jsonl", "{}\n")
        // A tool folder linked into Documents is left alone; a link elsewhere in home is fine.
        try FileManager.default.createSymbolicLink(atPath: home.path + "/.codex", withDestinationPath: home.path + "/Documents/claude")
        try FileManager.default.createSymbolicLink(atPath: home.path + "/.gemini", withDestinationPath: ".claude/real")
        XCTAssertFalse(FileFinder.isSafe(home.path + "/.codex/projects", home: home.path))
        XCTAssertFalse(FileFinder.isSafe(home.path + "/Documents/claude", home: home.path))
        XCTAssertTrue(FileFinder.isSafe(home.path + "/.gemini", home: home.path))
        XCTAssertTrue(FileFinder.isSafe(home.path + "/.claude/real", home: home.path))
        XCTAssertFalse(FileFinder.isSafe(home.path + "/.missing", home: home.path))
        // A chain of links that ends in Documents is followed as text and refused.
        try FileManager.default.createDirectory(atPath: home.path + "/.config", withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: home.path + "/.dotfiles", withDestinationPath: home.path + "/Documents/claude")
        try FileManager.default.createSymbolicLink(atPath: home.path + "/.config/claude", withDestinationPath: "../.dotfiles")
        XCTAssertFalse(FileFinder.isSafe(home.path + "/.config/claude/projects", home: home.path))
        XCTAssertFalse(FileFinder.isSafe(home.path + "/.config/claude", home: home.path))
        XCTAssertTrue(FileFinder.isGuarded("/Volumes/USB/x", home: home.path))
        XCTAssertTrue(FileFinder.isGuarded(home.path + "/Library/Mobile Documents/com~apple~CloudDocs", home: home.path))
        XCTAssertFalse(FileFinder.isGuarded(home.path + "/Library/Application Support/Claude", home: home.path))
    }
}

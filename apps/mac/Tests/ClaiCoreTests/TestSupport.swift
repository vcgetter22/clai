import Foundation
import XCTest
@testable import ClaiCore

/// A temporary folder that stands in for the user's home directory.
final class TempHome {
    let url: URL
    var path: String { url.path }

    init() {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("clai-tests-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    deinit { try? FileManager.default.removeItem(at: url) }

    @discardableResult
    func write(_ relative: String, _ text: String) -> String {
        let file = url.appendingPathComponent(relative)
        try! FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try! text.data(using: .utf8)!.write(to: file)
        return file.path
    }

    func append(_ relative: String, _ text: String) {
        let file = url.appendingPathComponent(relative)
        let handle = try! FileHandle(forWritingTo: file)
        handle.seekToEndOfFile()
        handle.write(text.data(using: .utf8)!)
        handle.closeFile()
    }

    func remove(_ relative: String) {
        try? FileManager.default.removeItem(at: url.appendingPathComponent(relative))
    }
}

func lines(_ objects: [[String: Any]]) -> String {
    objects.map { String(data: try! JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys]), encoding: .utf8)! + "\n" }.joined()
}

let utc = TimeZone(identifier: "UTC")!

/// Dollars for (tokens, USD per million tokens) pairs: `usd((1_000, 5), (200, 25))`.
func usd(_ parts: (Double, Double)...) -> Double {
    var total = 0.0
    for (tokens, rate) in parts { total += tokens * rate }
    return total / 1_000_000
}

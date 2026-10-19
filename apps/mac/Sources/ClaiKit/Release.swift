import Foundation

/// `0.4.1`, `v0.4.1` or `mac-v0.4.1`, compared numerically.
public struct SemanticVersion: Comparable, Sendable, CustomStringConvertible {
    public var major: Int
    public var minor: Int
    public var patch: Int

    public init(major: Int, minor: Int, patch: Int) {
        self.major = major
        self.minor = minor
        self.patch = patch
    }

    public init?(_ text: String) {
        var core = text
        if let range = core.range(of: "v", options: .backwards) { core = String(core[range.upperBound...]) }
        core = String(core.prefix { $0.isNumber || $0 == "." })
        let parts = core.split(separator: ".").map { Int($0) }
        guard parts.count >= 2, parts.count <= 3, parts.allSatisfy({ $0 != nil }) else { return nil }
        self.init(major: parts[0]!, minor: parts[1]!, patch: parts.count == 3 ? parts[2]! : 0)
    }

    public var description: String { "\(major).\(minor).\(patch)" }

    public static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
    }
}

/// The newest clai for Mac release on GitHub, from `GET /repos/vcgetter22/clai/releases/latest`.
public struct LatestRelease: Equatable, Sendable {
    public var version: SemanticVersion
    public var tag: String
    public var url: URL

    public static let endpoint = URL(string: "https://api.github.com/repos/vcgetter22/clai/releases/latest")!

    /// Parses the GitHub response; only `mac-v*` tags describe the Mac app.
    public static func parse(_ data: Data) -> LatestRelease? {
        struct Payload: Decodable {
            var tag_name: String
            var html_url: String
            var draft: Bool?
            var prerelease: Bool?
        }
        guard let payload = try? JSONDecoder().decode(Payload.self, from: data),
              payload.tag_name.hasPrefix("mac-v"),
              payload.draft != true, payload.prerelease != true,
              let version = SemanticVersion(payload.tag_name),
              let url = URL(string: payload.html_url) else { return nil }
        return LatestRelease(version: version, tag: payload.tag_name, url: url)
    }

    public func isNewer(than installed: String) -> Bool {
        guard let current = SemanticVersion(installed) else { return false }
        return version > current
    }
}

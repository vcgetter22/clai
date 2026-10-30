import Foundation

/// `1.2.3`, `v1.2.3` or `mac-v1.2.3`, compared numerically.
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
        // The first `1.2` or `1.2.3` in the text: `mac-v1.2.3`, `v1.2`, `1.0.0-dev`.
        guard let range = text.range(of: #"[0-9]+(\.[0-9]+){1,2}"#, options: .regularExpression) else { return nil }
        let parts = text[range].split(separator: ".").compactMap { Int($0) }
        guard (2...3).contains(parts.count) else { return nil }
        self.init(major: parts[0], minor: parts[1], patch: parts.count == 3 ? parts[2] : 0)
    }

    public var description: String { "\(major).\(minor).\(patch)" }

    public static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
    }
}

/// The newest clai for Mac release, from `GET https://api.github.com/repos/vcgetter22/clai/releases/latest`.
public struct LatestRelease: Equatable, Sendable {
    public var version: SemanticVersion
    public var page: URL

    public static let endpoint = URL(string: "https://api.github.com/repos/vcgetter22/clai/releases/latest")!

    /// Only published `mac-v*` releases describe the Mac app.
    public static func parse(_ data: Data) -> LatestRelease? {
        struct Payload: Decodable {
            var tag_name: String
            var html_url: String
            var draft: Bool?
            var prerelease: Bool?
        }
        guard let payload = try? JSONDecoder().decode(Payload.self, from: data),
              payload.tag_name.hasPrefix("mac-v"), payload.draft != true, payload.prerelease != true,
              let version = SemanticVersion(payload.tag_name), let page = URL(string: payload.html_url) else { return nil }
        return LatestRelease(version: version, page: page)
    }

    public func isNewer(than installed: String) -> Bool {
        guard let current = SemanticVersion(installed) else { return false }
        return version > current
    }
}

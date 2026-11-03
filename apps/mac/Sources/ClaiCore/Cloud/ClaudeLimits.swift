import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

/// Claude's plan limits (Pro, Max and Ultra): how much of the 5-hour and weekly limits is used.
/// They count everything the account does, on claude.ai, in the apps, in cloud sessions, in Cowork
/// and in Claude Code anywhere, so they are the one figure that includes cloud usage on a personal
/// plan, which has no usage report.
///
/// Claude Code (v2.1.80 or later) passes them to a status line command as `rate_limits`
/// (code.claude.com/docs/en/statusline). clai's status line command (`clai --status-line`) saves
/// them to `claude-limits.json` and then runs the user's own status line command, if there was one.
public enum ClaudeLimits {
    /// The limits in the JSON Claude Code passes to a status line command, nil when it has none.
    /// Only the numbers under `rate_limits` are read (the JSON passes through `JSON.object`, which
    /// empties every other string).
    public static func parse(statusLine data: Data, now: Double) -> RateLimits? {
        guard let object = data.withUnsafeBytes({ JSON.object($0) }),
              let limits = object["rate_limits"] as? [String: Any] else { return nil }
        func window(_ name: String, minutes: Int) -> RateLimits.Window? {
            guard let window = limits[name] as? [String: Any],
                  let used = JSON.double(window["used_percentage"]), used.isFinite else { return nil }
            let resets = JSON.double(window["resets_at"]).flatMap(Timestamp.fromEpoch)
            return RateLimits.Window(usedPercent: min(max(used, 0), 1_000), windowMinutes: minutes, resetsAt: resets)
        }
        let fiveHours = window("five_hour", minutes: 300)
        let week = window("seven_day", minutes: 10_080)
        guard fiveHours != nil || week != nil else { return nil }
        return RateLimits(primary: fiveHours, secondary: week, planType: nil, observedAt: now)
    }

    /// New limits over stored ones: a window the new data leaves out keeps its stored value until
    /// that window resets (Claude Code drops a window once it resets, and has none before a
    /// session's first reply).
    public static func merge(_ new: RateLimits, over old: RateLimits?, now: Double) -> RateLimits {
        func keep(_ window: RateLimits.Window?) -> RateLimits.Window? {
            guard let window, let resets = window.resetsAt, resets > now else { return nil }
            return window
        }
        var out = new
        if out.primary == nil { out.primary = keep(old?.primary) }
        if out.secondary == nil { out.secondary = keep(old?.secondary) }
        return out
    }

    private struct File: Codable {
        struct Window: Codable {
            var used: Double
            var resets: Double?
        }

        var observed: Double
        var fiveHour: Window?
        var sevenDay: Window?

        enum CodingKeys: String, CodingKey {
            case observed, fiveHour = "five_hour", sevenDay = "seven_day"
        }
    }

    /// The limits saved at `url`, or nil.
    public static func load(from url: URL) -> RateLimits? {
        guard let data = try? Data(contentsOf: url), let file = try? JSONDecoder().decode(File.self, from: data) else { return nil }
        func window(_ w: File.Window?, minutes: Int) -> RateLimits.Window? {
            guard let w, w.used.isFinite else { return nil }
            return RateLimits.Window(usedPercent: min(max(w.used, 0), 1_000), windowMinutes: minutes, resetsAt: w.resets)
        }
        let limits = RateLimits(primary: window(file.fiveHour, minutes: 300), secondary: window(file.sevenDay, minutes: 10_080),
                                planType: nil, observedAt: file.observed)
        return limits.primary == nil && limits.secondary == nil ? nil : limits
    }

    public static func save(_ limits: RateLimits, to url: URL) throws {
        func window(_ w: RateLimits.Window?) -> File.Window? { w.map { File.Window(used: $0.usedPercent, resets: $0.resetsAt) } }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(File(observed: limits.observedAt, fiveHour: window(limits.primary), sevenDay: window(limits.secondary)))
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
}

/// clai's status line command in Claude Code's user settings (`~/.claude/settings.json`).
///
/// Connecting puts `'<clai>' --status-line` in the `statusLine` setting and keeps the setting it
/// replaced in clai's folder; clai's command runs that one after saving the limits, so the status
/// line looks as before. Disconnecting puts the old setting back. The settings file is edited as
/// text, only where `statusLine` is, so the rest of it stays exactly as it was.
public enum ClaudeStatusLine {
    public static let flag = "--status-line"

    public static func settingsPath(home: String) -> String { home + "/.claude/settings.json" }

    /// The command that runs clai's executable at `executable` as a status line.
    public static func command(executable: String) -> String {
        "'" + executable.replacingOccurrences(of: "'", with: "'\\''") + "' " + flag
    }

    /// Whether a status line command is clai's.
    public static func isClai(_ command: String?) -> Bool {
        guard let command else { return false }
        return command.hasSuffix(" " + flag) && command.lowercased().contains("clai")
    }

    /// What clai remembers in `claude-status-line.json`: the setting it replaced (as JSON text;
    /// nil when there was none) and the command it put in.
    public struct Installed: Codable, Equatable, Sendable {
        public var previous: String?
        public var command: String

        public init(previous: String?, command: String) {
            self.previous = previous
            self.command = command
        }

        public static func load(from url: URL) -> Installed? {
            guard let data = try? Data(contentsOf: url) else { return nil }
            return try? JSONDecoder().decode(Installed.self, from: data)
        }

        public func save(to url: URL) throws {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try encoder.encode(self).write(to: url, options: .atomic)
        }

        /// The user's own command, which clai runs after saving the limits.
        public var previousCommand: String? {
            guard let previous, let setting = ClaudeStatusLine.object(previous),
                  setting["type"] as? String ?? "command" == "command",
                  let command = setting["command"] as? String,
                  !command.trimmingCharacters(in: .whitespaces).isEmpty, !ClaudeStatusLine.isClai(command) else { return nil }
            return command
        }
    }

    public enum EditError: Error, Equatable {
        /// The settings file is not a JSON object; clai leaves it alone.
        case notAnObject
    }

    /// The status line command in a settings text, if any.
    public static func currentCommand(in text: String?) -> String? {
        guard let text, let member = members(of: text)?.first(where: { $0.key == "statusLine" }),
              let setting = object(member.value) else { return nil }
        return setting["command"] as? String
    }

    /// Connecting: the settings text with clai's status line, and what to remember. Connecting
    /// again (clai moved, or connected twice) keeps the user's setting remembered the first time:
    /// clai never runs itself.
    public static func connect(executable: String, settings text: String?, remembered: Installed?) throws -> (text: String, installed: Installed) {
        let ours = command(executable: executable)
        let (updated, replaced) = try install(command: ours, in: text)
        let replacedIsClai = isClai(replaced.flatMap(object)?["command"] as? String)
        return (updated, Installed(previous: replacedIsClai ? remembered?.previous : replaced, command: ours))
    }

    /// Disconnecting: the settings text with the user's own setting back. Nil when the status line
    /// is no longer clai's, so there is nothing to change.
    public static func disconnect(settings text: String, remembered: Installed?) -> String? {
        uninstall(in: text, previous: remembered?.previous)
    }

    /// The settings text with clai's status line, and the `statusLine` setting it replaced (JSON
    /// text, nil when there was none). Fields of the old setting other than its command (such as
    /// `padding`) are kept.
    public static func install(command: String, in text: String?) throws -> (text: String, previous: String?) {
        let source = text ?? ""
        var setting: [String: Any] = [:]
        guard !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            setting = ["type": "command", "command": command]
            return ("{\n  \"statusLine\": " + serialize(setting) + "\n}\n", nil)
        }
        guard let all = members(of: source) else { throw EditError.notAnObject }
        let bytes = Array(source.utf8)
        var out: [UInt8]
        var previous: String?
        if let member = all.first(where: { $0.key == "statusLine" }) {
            previous = member.value
            if let old = object(member.value), old["type"] as? String ?? "command" == "command" { setting = old }
            setting["type"] = "command"
            setting["command"] = command
            out = Array(bytes[..<member.valueStart]) + Array(serialize(setting).utf8) + Array(bytes[member.valueEnd...])
        } else {
            setting = ["type": "command", "command": command]
            let open = all.openBrace + 1
            let insert = "\n  \"statusLine\": " + serialize(setting) + (all.isEmpty ? "\n" : ",")
            out = Array(bytes[..<open]) + Array(insert.utf8) + Array(bytes[open...])
        }
        let result = String(decoding: out, as: UTF8.self)
        guard object(result) != nil else { throw EditError.notAnObject }
        return (result, previous)
    }

    /// The settings text with clai's status line taken out: the setting it replaced goes back, or
    /// the `statusLine` setting goes away. Nil when the status line is no longer clai's (changed
    /// since): then nothing is changed.
    public static func uninstall(in text: String, previous: String?) -> String? {
        guard let all = members(of: text), let index = all.firstIndex(where: { $0.key == "statusLine" }),
              isClai(object(all[index].value)?["command"] as? String) else { return nil }
        let bytes = Array(text.utf8)
        let member = all[index]
        var out: [UInt8]
        if let previous, object(previous) != nil || previous.trimmingCharacters(in: .whitespaces) == "null" {
            out = Array(bytes[..<member.valueStart]) + Array(previous.utf8) + Array(bytes[member.valueEnd...])
        } else if index + 1 < all.count {
            // Up to the next member's key, which takes the comma and the line break with it.
            out = Array(bytes[..<member.keyStart]) + Array(bytes[all[index + 1].keyStart...])
        } else if index > 0 {
            // The last member: from the end of the one before, which takes the comma.
            out = Array(bytes[..<all[index - 1].valueEnd]) + Array(bytes[member.valueEnd...])
        } else {
            // The only member: what is left is an empty object.
            var rest = Array(bytes[member.valueEnd...])
            while let first = rest.first, first == 0x20 || first == 0x0A || first == 0x0D || first == 0x09 { rest.removeFirst() }
            out = Array(bytes[..<(all.openBrace + 1)]) + Array("\n".utf8) + rest
        }
        let result = String(decoding: out, as: UTF8.self)
        return object(result) != nil ? result : nil
    }

    // MARK: JSON text

    struct Member {
        var key: String
        /// The value's JSON text.
        var value: String
        /// Byte offsets into the text's UTF-8: where the key's quote starts, and the value's range.
        var keyStart: Int
        var valueStart: Int
        var valueEnd: Int
    }

    struct Members: RandomAccessCollection {
        var items: [Member]
        var openBrace: Int
        var startIndex: Int { items.startIndex }
        var endIndex: Int { items.endIndex }
        subscript(i: Int) -> Member { items[i] }
    }

    /// The members of the JSON object in `text`, top level only; nil when the text is not an object.
    static func members(of text: String) -> Members? {
        let b = Array(text.utf8)
        var i = 0
        func skipSpace() { while i < b.count, b[i] == 0x20 || b[i] == 0x0A || b[i] == 0x0D || b[i] == 0x09 { i += 1 } }
        func skipString() -> Bool {
            guard i < b.count, b[i] == 0x22 else { return false }
            i += 1
            while i < b.count {
                if b[i] == 0x5C { i += 2; continue }
                if b[i] == 0x22 { i += 1; return true }
                i += 1
            }
            return false
        }
        func skipValue() -> Bool {
            guard i < b.count else { return false }
            switch b[i] {
            case 0x22:
                return skipString()
            case 0x7B, 0x5B:
                var depth = 0
                while i < b.count {
                    switch b[i] {
                    case 0x22:
                        guard skipString() else { return false }
                        continue
                    case 0x7B, 0x5B:
                        depth += 1
                    case 0x7D, 0x5D:
                        depth -= 1
                        if depth == 0 { i += 1; return true }
                    default:
                        break
                    }
                    i += 1
                }
                return false
            default:
                let start = i
                while i < b.count, ![0x2C, 0x7D, 0x5D, 0x20, 0x0A, 0x0D, 0x09].contains(b[i]) { i += 1 }
                return i > start
            }
        }

        skipSpace()
        guard i < b.count, b[i] == 0x7B else { return nil }
        let open = i
        i += 1
        var items: [Member] = []
        skipSpace()
        if i < b.count, b[i] == 0x7D { return Members(items: [], openBrace: open) }
        while true {
            skipSpace()
            let keyStart = i
            guard skipString() else { return nil }
            let key = String(decoding: b[(keyStart + 1)..<(i - 1)], as: UTF8.self)
            skipSpace()
            guard i < b.count, b[i] == 0x3A else { return nil }
            i += 1
            skipSpace()
            let valueStart = i
            guard skipValue() else { return nil }
            items.append(Member(key: key, value: String(decoding: b[valueStart..<i], as: UTF8.self),
                                keyStart: keyStart, valueStart: valueStart, valueEnd: i))
            skipSpace()
            guard i < b.count else { return nil }
            if b[i] == 0x2C { i += 1; continue }
            if b[i] == 0x7D { break }
            return nil
        }
        return Members(items: items, openBrace: open)
    }

    static func object(_ text: String) -> [String: Any]? {
        guard let data = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func serialize(_ setting: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: setting, options: [.sortedKeys, .withoutEscapingSlashes]) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }
}

/// `clai --status-line`: what runs each time Claude Code updates its status line.
public enum StatusLineRunner {
    /// Saves the plan limits in `input` (the JSON Claude Code passes) and runs the user's own
    /// status line command with the same input; its output is the status line. Returns the exit
    /// status. Never fails because of clai: without a command of the user's, the status line is empty.
    public static func run(input: Data, limitsURL: URL, installedURL: URL, now: Double = Date().timeIntervalSince1970,
                           output: FileHandle? = nil) -> Int32 {
        if let limits = ClaudeLimits.parse(statusLine: input, now: now) {
            let merged = ClaudeLimits.merge(limits, over: ClaudeLimits.load(from: limitsURL), now: now)
            try? ClaudeLimits.save(merged, to: limitsURL)
        }
        guard let command = ClaudeStatusLine.Installed.load(from: installedURL)?.previousCommand else { return 0 }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", command]
        let stdin = Pipe()
        process.standardInput = stdin
        if let output { process.standardOutput = output }
        do {
            try process.run()
        } catch {
            return 1
        }
        // A command that does not read its input may exit first: writing then fails, quietly.
        signal(SIGPIPE, SIG_IGN)
        try? stdin.fileHandleForWriting.write(contentsOf: input)
        try? stdin.fileHandleForWriting.close()
        process.waitUntilExit()
        return process.terminationStatus
    }
}

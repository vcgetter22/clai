import Foundation

/// One line of the ledger: a quarter hour, a tool, a model and the price tier its requests were
/// billed at.
public struct BucketKey: Hashable, Sendable {
    public var quarter: Quarter
    public var tool: Tool
    public var model: String
    /// Requests over the model's long-context threshold.
    public var long: Bool
    /// Requests in Claude Code's fast mode.
    public var fast: Bool

    public init(quarter: Quarter, tool: Tool, model: String, long: Bool = false, fast: Bool = false) {
        self.quarter = quarter
        self.tool = tool
        self.model = model
        self.long = long
        self.fast = fast
    }

    var slot: Slot { Slot(quarter: quarter, tool: tool) }
}

/// What the ledger compares: one tool's requests in one quarter hour.
struct Slot: Hashable {
    var quarter: Quarter
    var tool: Tool
}

public struct BucketValue: Sendable, Equatable {
    public var tokens: Tokens
    public var requests: Int
    public var webSearches: Int
    /// What the tool itself logged as cost (OpenCode does); used only for models clai has no price for.
    public var loggedCost: Double

    public init(tokens: Tokens = .zero, requests: Int = 0, webSearches: Int = 0, loggedCost: Double = 0) {
        self.tokens = tokens
        self.requests = requests
        self.webSearches = webSearches
        self.loggedCost = loggedCost
    }

    public mutating func add(_ event: UsageEvent) {
        tokens += event.tokens
        requests += 1
        webSearches += event.webSearches
        loggedCost += event.loggedCost ?? 0
    }
}

/// Usage per quarter hour, tool and model, kept in `~/Library/Application Support/clai/ledger.json`.
///
/// The logs are the source of truth while they exist. The ledger keeps what they said, so the
/// month and the history survive when a tool deletes old logs (Claude Code removes transcripts
/// after 30 days by default). For each quarter hour and tool, the side that counted more requests
/// wins: a fresh count of logs still on disk replaces the stored one, and a quarter hour whose logs
/// are gone keeps its stored total. Quarter hours, not days, so that a change of time zone moves
/// nothing between days that is stored.
public struct Ledger: Sendable, Equatable {
    /// Bump when a reader changes what it counts: the next launch recounts the quarter hours whose
    /// logs are complete instead of keeping the larger number.
    public static let readersVersion = 1
    static let formatVersion = 2

    public private(set) var buckets: [BucketKey: BucketValue]
    /// The readers version the stored totals were counted with.
    public private(set) var readers: Int
    /// Rows of tools this version does not know (written by a newer clai): kept as they are.
    private var foreign: [Row] = []
    /// The file on disk could not be read and was not moved aside: never write over it.
    public private(set) var isReadOnly = false

    public init(buckets: [BucketKey: BucketValue] = [:], readers: Int = Ledger.readersVersion) {
        self.buckets = buckets
        self.readers = readers
    }

    /// Adds up events into ledger lines. `days` tells which day's price applies.
    public static func buckets(from events: [UsageEvent], pricer: Pricer, days: inout DayResolver) -> [BucketKey: BucketValue] {
        var out: [BucketKey: BucketValue] = [:]
        for event in events {
            let price = pricer.match(event.model)?.price(on: days.day(at: event.time))
            let key = BucketKey(
                quarter: Quarter(time: event.time),
                tool: event.tool,
                model: event.model,
                long: price?.isLong(event.tokens) ?? false,
                fast: event.fast && (price?.fast ?? 1) > 1
            )
            out[key, default: BucketValue()].add(event)
        }
        return out
    }

    /// Takes in a complete count of the logs on disk. Returns whether anything changed.
    ///
    /// `completeSince` tells, per tool, from when on the logs hold every request: the tools delete
    /// whole log files, oldest first, so nothing written after the oldest remaining file's last
    /// change is missing. Only there may a recount (after a reader change) lower a stored total.
    @discardableResult
    public mutating func merge(live: [BucketKey: BucketValue], completeSince: [Tool: Double] = [:]) -> Bool {
        let recount = readers != Ledger.readersVersion
        func recounted(_ slot: Slot) -> Bool {
            guard recount, let since = completeSince[slot.tool] else { return false }
            return slot.quarter.start >= since
        }
        var liveRequests: [Slot: Int] = [:]
        for (key, value) in live { liveRequests[key.slot, default: 0] += value.requests }
        var storedRequests: [Slot: Int] = [:]
        for (key, value) in buckets { storedRequests[key.slot, default: 0] += value.requests }

        var replace = Set<Slot>()
        for (slot, count) in liveRequests where recounted(slot) || count >= storedRequests[slot, default: 0] {
            replace.insert(slot)
        }
        var next = buckets.filter { !replace.contains($0.key.slot) && !recounted($0.key.slot) }
        for (key, value) in live where replace.contains(key.slot) { next[key] = value }
        let changed = next != buckets || recount
        buckets = next
        readers = Ledger.readersVersion
        return changed
    }

    // MARK: Storage

    private struct Header: Decodable {
        var format: Int
    }

    private struct File: Codable {
        var format: Int
        var readers: Int
        var rows: [Row]
    }

    private struct Row: Codable, Equatable, Sendable {
        var q: Int32
        var t: String
        var m: String
        var l: Bool?
        var f: Bool?
        var n: Int
        var s: Int?
        var c: Double?
        var k: Tokens
    }

    /// The ledger stored at `url`, or an empty one when there is none.
    ///
    /// A file this version cannot read is never written over: a damaged one (or one from a
    /// development build) is renamed `ledger-unreadable-<time>.json` and clai starts over; one from
    /// a newer clai is left alone and this copy keeps no history.
    public static func load(from url: URL) -> Ledger {
        let files = FileManager.default
        guard files.fileExists(atPath: url.path) else { return Ledger() }
        var readOnly = Ledger()
        readOnly.isReadOnly = true
        guard let data = try? Data(contentsOf: url) else { return readOnly }
        if let header = try? JSONDecoder().decode(Header.self, from: data), header.format > formatVersion {
            return readOnly
        }
        guard let file = try? JSONDecoder().decode(File.self, from: data), file.format == formatVersion else {
            let aside = url.deletingLastPathComponent()
                .appendingPathComponent("ledger-unreadable-\(Int(Date().timeIntervalSince1970)).json")
            return (try? files.moveItem(at: url, to: aside)) != nil ? Ledger() : readOnly
        }
        var ledger = Ledger(readers: file.readers)
        for row in file.rows {
            guard let tool = Tool(rawValue: row.t) else {
                ledger.foreign.append(row)
                continue
            }
            let key = BucketKey(quarter: Quarter(rawValue: row.q), tool: tool, model: row.m, long: row.l ?? false, fast: row.f ?? false)
            ledger.buckets[key, default: BucketValue()].merge(
                BucketValue(tokens: row.k, requests: row.n, webSearches: row.s ?? 0, loggedCost: row.c ?? 0)
            )
        }
        return ledger
    }

    /// Writes the ledger atomically; does nothing when the file on disk must not be replaced.
    public func save(to url: URL) throws {
        guard !isReadOnly else { return }
        let rows = buckets
            .sorted { ($0.key.quarter, $0.key.tool, $0.key.model) < ($1.key.quarter, $1.key.tool, $1.key.model) }
            .map { key, value in
                Row(q: key.quarter.rawValue, t: key.tool.rawValue, m: key.model,
                    l: key.long ? true : nil, f: key.fast ? true : nil,
                    n: value.requests, s: value.webSearches == 0 ? nil : value.webSearches,
                    c: value.loggedCost == 0 ? nil : value.loggedCost, k: value.tokens)
            }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(File(format: Ledger.formatVersion, readers: readers, rows: rows + foreign))
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
}

extension BucketValue {
    /// Adds another line's numbers (two rows of the same key in a file written by hand).
    mutating func merge(_ other: BucketValue) {
        tokens += other.tokens
        requests += other.requests
        webSearches += other.webSearches
        loggedCost += other.loggedCost
    }
}

private func < (lhs: (Quarter, Tool, String), rhs: (Quarter, Tool, String)) -> Bool {
    if lhs.0 != rhs.0 { return lhs.0 < rhs.0 }
    if lhs.1 != rhs.1 { return lhs.1 < rhs.1 }
    return lhs.2 < rhs.2
}

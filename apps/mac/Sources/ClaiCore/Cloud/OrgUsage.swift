import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Anthropic's usage report for an organization: the Usage and Cost Analytics API
/// (`GET /v1/organizations/analytics/usage`, beta), documented at
/// platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api.
///
/// It covers what no log on this Mac holds: claude.ai chat, Claude Code and Cowork sessions that run
/// in Anthropic's cloud or on other computers, Claude Design, Claude in Chrome and Slack, and the
/// Claude API. A Claude Console organization reads it with an Admin API key, a Claude Enterprise
/// organization with an Analytics API key (scope `read:analytics`). Individual Pro and Max plans
/// have no such report.
///
/// clai asks for token counts per UTC hour, model, product, context-window tier and speed, and
/// keeps nothing else: no names or e-mail addresses, no content (the report has none). To count one
/// person's usage, it looks up their user id by e-mail address and filters by it.
public enum OrgUsage {
    public static let endpoint = "https://api.anthropic.com/v1/organizations/analytics/usage"
    public static let betaHeader = "analytics-usage-cost-2026-08-24"
    public static let apiVersion = "2023-06-01"
    /// The report starts on 2026-01-01 and reaches back at most 365 days.
    static let earliest: Double = 1_767_225_600
    /// One request may span at most 31 days.
    static let maxSpan: Double = 31 * 86_400

    /// The tool a product's usage is shown under.
    public static func tool(forProduct product: String) -> Tool {
        switch product {
        case "claude_code": return .claudeCodeCloud
        case "cowork": return .coworkCloud
        // Usage without a product (code execution and the like) belongs to the API.
        case "messages_api", "message_batches_api", "managed_agents_api", "claude_console", "": return .claudeAPI
        // chat, chat_cowork_unified, claude_design, claude_in_chrome, claude_tag, office_agent and
        // products added later.
        default: return .claudeApps
        }
    }

    /// The local tool whose logs can hold the same requests. Claude Code and Cowork also run on
    /// this Mac, and the report counts those sessions too when they belong to the organization.
    static func localTool(forProduct product: String) -> Tool? {
        switch product {
        case "claude_code": return .claudeCode
        case "cowork", "chat_cowork_unified": return .cowork
        default: return nil
        }
    }

    /// `2026-09-01T00:00:00Z`
    static func iso(_ time: Double) -> String {
        let seconds = Int(time.rounded(.down))
        let days = seconds >= 0 ? seconds / 86_400 : (seconds - 86_399) / 86_400
        let rest = seconds - days * 86_400
        let (y, m, d) = CivilDate.civilFromDays(days)
        return String(format: "%04d-%02d-%02dT%02d:%02d:%02dZ", y, m, d, rest / 3600, rest / 60 % 60, rest % 60)
    }

    static func hourStart(_ time: Double) -> Double { (time / 3600).rounded(.down) * 3600 }
}

/// One request for a page of the report.
public struct OrgUsageQuery: Equatable, Sendable {
    /// Start and end of the range, whole UTC hours, at most 31 days apart.
    public var start: Double
    public var end: Double
    /// Only the usage attributed to this user (`user_…`).
    public var actorId: String?
    /// Instead of usage: who used the organization in the range, one row per person.
    public var actors: Bool
    /// The cursor of the page to read.
    public var page: String?

    public init(start: Double, end: Double, actorId: String? = nil, actors: Bool = false, page: String? = nil) {
        self.start = start
        self.end = end
        self.actorId = actorId
        self.actors = actors
        self.page = page
    }

    public var url: URL {
        var items: [(String, String)] = [("starting_at", OrgUsage.iso(start)), ("ending_at", OrgUsage.iso(end))]
        if actors {
            items += [("group_by[]", "actor"), ("limit", "1000")]
        } else {
            items += [
                ("time_bucket_width", "1h"),
                ("group_by[]", "model"),
                ("group_by[]", "product"),
                ("group_by[]", "context_window"),
                ("group_by[]", "speed"),
            ]
            if let actorId { items.append(("actor_ids[]", actorId)) }
            items += [("order_by", "time"), ("order", "asc"), ("limit", "1000")]
        }
        if let page { items.append(("page", page)) }
        let query = items.map { OrgUsageQuery.encode($0.0) + "=" + OrgUsageQuery.encode($0.1) }.joined(separator: "&")
        return URL(string: OrgUsage.endpoint + "?" + query)!
    }

    public func request(key: String, userAgent: String) -> URLRequest {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue(key, forHTTPHeaderField: "x-api-key")
        request.setValue(OrgUsage.apiVersion, forHTTPHeaderField: "anthropic-version")
        request.setValue(OrgUsage.betaHeader, forHTTPHeaderField: "anthropic-beta")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        return request
    }

    private static let unreserved = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")

    static func encode(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? text
    }
}

/// Usage of one product and model in one UTC hour, as the report gives it.
public struct OrgRow: Codable, Equatable, Sendable {
    /// Hours since 1970-01-01 00:00 UTC.
    public var hour: Int32
    /// The report's product (`claude_code`, `chat`, `messages_api`…); empty when it names none.
    public var product: String
    /// The model id; empty when the report names none.
    public var model: String
    /// Billed at the model's long-context rates (the `200k-1M` tier).
    public var long: Bool
    /// Fast mode.
    public var fast: Bool
    public var requests: Int
    public var webSearches: Int
    public var tokens: Tokens

    public init(hour: Int32, product: String, model: String, long: Bool = false, fast: Bool = false,
                requests: Int, webSearches: Int = 0, tokens: Tokens) {
        self.hour = hour
        self.product = product
        self.model = model
        self.long = long
        self.fast = fast
        self.requests = requests
        self.webSearches = webSearches
        self.tokens = tokens
    }

    struct Key: Hashable {
        var hour: Int32
        var product: String
        var model: String
        var long: Bool
        var fast: Bool
    }

    var key: Key { Key(hour: hour, product: product, model: model, long: long, fast: fast) }

    var value: BucketValue { BucketValue(tokens: tokens, requests: requests, webSearches: webSearches) }

    mutating func add(_ other: OrgRow) {
        tokens += other.tokens
        requests += other.requests
        webSearches += other.webSearches
    }

    var isEmpty: Bool { tokens.isZero && requests == 0 && webSearches == 0 }

    enum CodingKeys: String, CodingKey {
        case hour = "h", product = "p", model = "m", long = "l", fast = "f", requests = "n", webSearches = "s", tokens = "k"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        hour = try c.decode(Int32.self, forKey: .hour)
        product = try c.decodeIfPresent(String.self, forKey: .product) ?? ""
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        long = try c.decodeIfPresent(Bool.self, forKey: .long) ?? false
        fast = try c.decodeIfPresent(Bool.self, forKey: .fast) ?? false
        requests = try c.decodeIfPresent(Int.self, forKey: .requests) ?? 0
        webSearches = try c.decodeIfPresent(Int.self, forKey: .webSearches) ?? 0
        tokens = try c.decodeIfPresent(Tokens.self, forKey: .tokens) ?? .zero
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(hour, forKey: .hour)
        if !product.isEmpty { try c.encode(product, forKey: .product) }
        if !model.isEmpty { try c.encode(model, forKey: .model) }
        if long { try c.encode(long, forKey: .long) }
        if fast { try c.encode(fast, forKey: .fast) }
        try c.encode(requests, forKey: .requests)
        if webSearches != 0 { try c.encode(webSearches, forKey: .webSearches) }
        try c.encode(tokens, forKey: .tokens)
    }
}

/// One page of the report.
public struct OrgUsagePage: Equatable, Sendable {
    public var rows: [OrgRow]
    public var hasMore: Bool
    public var nextPage: String?
    /// The report's `data_refreshed_at`: usage after it is missing or partial.
    public var refreshedAt: Double?

    /// Reads a page.
    public static func parse(_ data: Data) throws -> OrgUsagePage {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let items = object["data"] as? [Any] else { throw OrgUsageError.malformed }
        var merged: [OrgRow.Key: OrgRow] = [:]
        var order: [OrgRow.Key] = []
        for case let item as [String: Any] in items {
            guard let start = (item["starting_at"] as? String).flatMap(Timestamp.parse) else { continue }
            let group = item["group"] as? [String: Any] ?? [:]
            let usage = item["usage"] as? [String: Any] ?? [:]
            let writes = usage["cache_creation"] as? [String: Any] ?? [:]
            let searches = (usage["server_tool_use"] as? [String: Any])?["web_search_requests"]
            let row = OrgRow(
                hour: Int32(clamping: Int((start / 3600).rounded(.down))),
                product: group["product"] as? String ?? "",
                model: group["model"] as? String ?? "",
                long: (group["context_window"] as? String) == "200k-1M",
                fast: (group["speed"] as? String) == "fast",
                requests: Int(JSON.int(usage["requests"])),
                webSearches: Int(min(JSON.int(searches), 1_000_000)),
                tokens: Tokens(
                    input: JSON.int(usage["uncached_input_tokens"]),
                    output: JSON.int(usage["output_tokens"]),
                    cacheRead: JSON.int(usage["cache_read_input_tokens"]),
                    cacheWrite: JSON.int(writes["ephemeral_5m_input_tokens"]),
                    cacheWrite1h: JSON.int(writes["ephemeral_1h_input_tokens"])
                )
            )
            // Rows without a model and without tokens are code-execution time, not model requests.
            guard !row.isEmpty, !(row.model.isEmpty && row.tokens.isZero && row.webSearches == 0) else { continue }
            if merged[row.key] == nil {
                merged[row.key] = row
                order.append(row.key)
            } else {
                merged[row.key]!.add(row)
            }
        }
        let next = object["next_page"] as? String
        return OrgUsagePage(
            rows: order.map { merged[$0]! },
            hasMore: (object["has_more"] as? Bool ?? false) && next?.isEmpty == false,
            nextPage: next,
            refreshedAt: (object["data_refreshed_at"] as? String).flatMap(Timestamp.parse)
        )
    }
}

/// A page of the people who used the organization (`OrgUsageQuery.actors`).
public struct OrgActorsPage: Equatable, Sendable {
    /// The user id of the person with this e-mail address, when the page has them.
    public var userId: String?
    public var hasMore: Bool
    public var nextPage: String?

    /// Reads a page and looks for `email` (compared without case). Names and the other addresses
    /// are dropped.
    public static func parse(_ data: Data, email: String) throws -> OrgActorsPage {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let items = object["data"] as? [Any] else { throw OrgUsageError.malformed }
        let wanted = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var found: String?
        for case let item as [String: Any] in items {
            guard let actor = (item["group"] as? [String: Any])?["actor"] as? [String: Any],
                  (actor["email_address"] as? String)?.lowercased() == wanted,
                  let id = actor["user_id"] as? String, !id.isEmpty else { continue }
            found = id
            break
        }
        let next = object["next_page"] as? String
        return OrgActorsPage(userId: found, hasMore: (object["has_more"] as? Bool ?? false) && next?.isEmpty == false, nextPage: next)
    }
}

public enum OrgUsageError: Error, Equatable, Sendable {
    /// Anthropic refused the request (a 4xx answer), with its message.
    case rejected(status: Int, message: String)
    /// Rate limited or a server error: try again later.
    case unavailable(status: Int)
    /// No connection.
    case offline(String)
    /// An answer clai cannot read.
    case malformed
    /// No one with this e-mail address used the organization in the last 31 days.
    case personNotFound(String)

    /// What the settings say.
    public var message: String {
        switch self {
        case .rejected(let status, let message):
            let detail = message.isEmpty ? "" : " Anthropic says: “\(message)”"
            switch status {
            case 401: return "Anthropic did not accept this key." + detail
            case 403: return "This key cannot read the usage report. It needs to be an Admin API key (Claude Console) or an Analytics API key with read:analytics (Claude Enterprise)." + detail
            default: return "Anthropic turned the request down (\(status))." + detail
            }
        case .unavailable(let status):
            return status == 429
                ? "Anthropic asked clai to slow down; it tries again later."
                : "Anthropic's usage report is not available right now (\(status)); clai tries again later."
        case .offline(let reason):
            return "Could not reach api.anthropic.com: \(reason)"
        case .malformed:
            return "Anthropic's answer could not be read; clai tries again later."
        case .personNotFound(let email):
            return "The report has no usage by \(email) in the last 31 days. Check the address, or clear it to count everyone."
        }
    }

    /// Whether the key itself is the problem (no point trying again with it).
    public var isKeyProblem: Bool {
        if case .rejected(let status, _) = self { return status == 401 || status == 403 }
        return false
    }

    static func from(status: Int, body: Data) -> OrgUsageError {
        if status == 429 || status >= 500 { return .unavailable(status: status) }
        let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        let message = (object?["error"] as? [String: Any])?["message"] as? String ?? ""
        return .rejected(status: status, message: String(message.prefix(300)))
    }
}

/// Reads the report over HTTPS.
public final class OrgUsageClient: @unchecked Sendable {
    /// Sends a request and returns the body and the HTTP status. Tests pass their own.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, Int)

    let key: String
    let userAgent: String
    let transport: Transport

    public init(key: String, userAgent: String, transport: Transport? = nil) {
        self.key = key
        self.userAgent = userAgent
        self.transport = transport ?? OrgUsageClient.urlSession
    }

    public static let urlSession: Transport = { request in
        try await withCheckedThrowingContinuation { continuation in
            URLSession.shared.dataTask(with: request) { data, response, error in
                if let error {
                    continuation.resume(throwing: OrgUsageError.offline(error.localizedDescription))
                } else {
                    continuation.resume(returning: (data ?? Data(), (response as? HTTPURLResponse)?.statusCode ?? 0))
                }
            }.resume()
        }
    }

    /// Usage from `start` to `end` (seconds since 1970), whole UTC hours, in requests of at most
    /// 31 days. With `onlyEmail`, only that person's usage.
    public func usage(from start: Double, to end: Double, onlyEmail: String? = nil, now: Double = Date().timeIntervalSince1970) async throws -> (rows: [OrgRow], refreshedAt: Double?) {
        let first = OrgUsage.hourStart(max(start, OrgUsage.earliest, now - 364 * 86_400))
        let last = OrgUsage.hourStart(min(end, now))
        var actorId: String?
        if let email = onlyEmail?.trimmingCharacters(in: .whitespacesAndNewlines), !email.isEmpty {
            actorId = try await userId(email: email, now: now)
        }
        var rows: [OrgRow.Key: OrgRow] = [:]
        var refreshed: Double?
        var windowStart = first
        while windowStart < last {
            let windowEnd = min(last, windowStart + OrgUsage.maxSpan)
            var query = OrgUsageQuery(start: windowStart, end: windowEnd, actorId: actorId)
            var restarted = false
            var pages = 0
            while true {
                let (data, status) = try await transport(query.request(key: key, userAgent: userAgent))
                if status == 410 && !restarted {
                    // The cursor expired because the report refreshed: read this window again.
                    restarted = true
                    query.page = nil
                    for stored in rows.keys where Double(stored.hour) * 3600 >= windowStart && Double(stored.hour) * 3600 < windowEnd {
                        rows[stored] = nil
                    }
                    continue
                }
                guard status == 200 else { throw OrgUsageError.from(status: status, body: data) }
                let page = try OrgUsagePage.parse(data)
                for row in page.rows {
                    if rows[row.key] == nil { rows[row.key] = row } else { rows[row.key]!.add(row) }
                }
                if let at = page.refreshedAt { refreshed = max(refreshed ?? at, at) }
                pages += 1
                guard page.hasMore, let next = page.nextPage, pages < 200 else { break }
                query.page = next
            }
            windowStart = windowEnd
        }
        let sorted = rows.values.sorted {
            ($0.hour, $0.product, $0.model, $0.long ? 1 : 0, $0.fast ? 1 : 0) < ($1.hour, $1.product, $1.model, $1.long ? 1 : 0, $1.fast ? 1 : 0)
        }
        return (sorted, refreshed)
    }

    /// The user id of the person with this e-mail address, among those who used the organization
    /// in the last 31 days (the longest range one request covers).
    func userId(email: String, now: Double) async throws -> String {
        let end = OrgUsage.hourStart(now)
        var query = OrgUsageQuery(start: max(OrgUsage.earliest, end - OrgUsage.maxSpan), end: end, actors: true)
        for _ in 0..<50 {
            let (data, status) = try await transport(query.request(key: key, userAgent: userAgent))
            guard status == 200 else { throw OrgUsageError.from(status: status, body: data) }
            let page = try OrgActorsPage.parse(data, email: email)
            if let id = page.userId { return id }
            guard page.hasMore, let next = page.nextPage else { break }
            query.page = next
        }
        throw OrgUsageError.personNotFound(email)
    }
}

/// The report's usage as clai last read it, in `~/Library/Application Support/clai/cloud.json`.
public struct OrgUsageStore: Equatable, Sendable {
    public private(set) var rows: [OrgRow]
    /// The report's `data_refreshed_at` at the last read.
    public private(set) var refreshedAt: Double?
    /// When clai last read the report, and last read all of it (from the start of last month).
    public private(set) var fetchedAt: Double?
    public private(set) var fullyFetchedAt: Double?

    static let formatVersion = 1

    public init(rows: [OrgRow] = [], refreshedAt: Double? = nil, fetchedAt: Double? = nil, fullyFetchedAt: Double? = nil) {
        self.rows = rows
        self.refreshedAt = refreshedAt
        self.fetchedAt = fetchedAt
        self.fullyFetchedAt = fullyFetchedAt
    }

    public var isEmpty: Bool { rows.isEmpty && fetchedAt == nil }

    /// Takes in a fresh read of `start..<end`: it replaces every stored hour in that range.
    public mutating func replace(from start: Double, to end: Double, with fresh: [OrgRow], refreshedAt: Double?, at now: Double, full: Bool) {
        // The same whole hours `OrgUsageClient.usage` reads.
        let first = Int32(clamping: Int((start / 3600).rounded(.down)))
        let last = Int32(clamping: Int((end / 3600).rounded(.down)))
        rows = rows.filter { $0.hour < first || $0.hour >= last }
            + fresh.filter { $0.hour >= first && $0.hour < last }
        rows.sort { ($0.hour, $0.product, $0.model) < ($1.hour, $1.product, $1.model) }
        if let refreshedAt { self.refreshedAt = refreshedAt }
        fetchedAt = now
        if full { fullyFetchedAt = now }
    }

    /// The range the next read should cover: everything from a day before the start of last month
    /// (in any time zone) when the last full read is 12 hours old, otherwise the last three days,
    /// where late usage still arrives.
    public func nextRange(now: Double) -> (start: Double, end: Double, full: Bool) {
        if let full = fullyFetchedAt, now - full < 12 * 3600 {
            return (now - 3 * 86_400, now, false)
        }
        let (y, m, _) = CivilDate.civilFromDays(Int((now / 86_400).rounded(.down)))
        let lastMonth = m == 1 ? CivilDate.daysFromCivil(year: y - 1, month: 12, day: 1) : CivilDate.daysFromCivil(year: y, month: m - 1, day: 1)
        return (Double(lastMonth - 1) * 86_400, now, true)
    }

    // MARK: What the panel shows

    /// The report's usage as ledger lines of the cloud tools.
    ///
    /// Claude Code and Cowork sessions on this Mac are in its logs, and the report counts them
    /// too when they belong to the organization. For those products only what goes beyond this
    /// Mac's logs is kept, per UTC day and model, so a request is never counted twice: each hour
    /// keeps its count beyond that hour's logs, scaled down so that the day keeps no more than its
    /// count beyond the day's logs (a request near the turn of an hour may sit in the other hour
    /// in the report). Totals are kept exact by carrying the rounding from line to line.
    public func derived(local: Ledger) -> [BucketKey: BucketValue] {
        guard !rows.isEmpty else { return [:] }
        struct Group: Hashable {
            var day: Int
            var tool: Tool
            var model: String
        }
        func day(ofHour hour: Int32) -> Int { Int(hour) >= 0 ? Int(hour) / 24 : (Int(hour) - 23) / 24 }
        func group(_ row: OrgRow) -> Group? {
            OrgUsage.localTool(forProduct: row.product).map { Group(day: day(ofHour: row.hour), tool: $0, model: Pricer.normalize(row.model)) }
        }

        // The shared products' counts per group and hour, in the report and in the logs.
        var reported: [Group: [Int32: Counts]] = [:]
        for row in rows {
            guard let g = group(row) else { continue }
            reported[g, default: [:]][row.hour, default: Counts()] += Counts(row.value)
        }
        var logged: [Group: [Int32: Counts]] = [:]
        if !reported.isEmpty {
            let days = Set(reported.keys.map(\.day))
            for (key, value) in local.buckets where key.tool == .claudeCode || key.tool == .cowork {
                let hour = Int32(clamping: Int((key.quarter.start / 3600).rounded(.down)))
                let g = Group(day: day(ofHour: hour), tool: key.tool, model: Pricer.normalize(key.model))
                guard days.contains(g.day), reported[g] != nil else { continue }
                logged[g, default: [:]][hour, default: Counts()] += Counts(value)
            }
        }

        // Per group and hour, the share of the hour's reported counts that is cloud usage.
        var share: [Group: [Int32: [Double]]] = [:]
        for (g, hours) in reported {
            guard let mine = logged[g] else { continue }
            let dayReported = hours.values.reduce(Counts(), +)
            let dayLogged = mine.values.reduce(Counts(), +)
            let dayLeft = dayReported.minus(dayLogged)
            // Reported minus logged per hour; a logged excess first cancels a reported excess in
            // the next or the previous hour, where the report may have put that request.
            var difference: [Int32: [Int64]] = [:]
            for hour in Set(hours.keys).union(mine.keys) {
                let reportedCounts = hours[hour] ?? Counts()
                let loggedCounts = mine[hour] ?? Counts()
                difference[hour] = (0..<Counts.size).map { reportedCounts[$0] - loggedCounts[$0] }
            }
            for hour in difference.keys.sorted() {
                for neighbour in [hour + 1, hour - 1] where difference[neighbour] != nil {
                    for i in 0..<Counts.size where difference[hour]![i] < 0 && difference[neighbour]![i] > 0 {
                        let moved = min(-difference[hour]![i], difference[neighbour]![i])
                        difference[hour]![i] += moved
                        difference[neighbour]![i] -= moved
                    }
                }
            }
            var hourLeft: [Int32: Counts] = [:]
            for hour in hours.keys {
                var left = Counts()
                for i in 0..<Counts.size { left[i] = max(0, difference[hour]![i]) }
                hourLeft[hour] = left
            }
            let sumLeft = hourLeft.values.reduce(Counts(), +)
            for (hour, counts) in hours {
                let left = hourLeft[hour]!
                share[g, default: [:]][hour] = (0..<Counts.size).map { i in
                    guard counts[i] > 0, sumLeft[i] > 0 else { return 0 }
                    // This hour's part of the day's count beyond the logs, as a share of the hour's count.
                    return Double(left[i]) * Double(dayLeft[i]) / Double(sumLeft[i]) / Double(counts[i])
                }
            }
        }

        var out: [BucketKey: BucketValue] = [:]
        var carry: [Group: [Double]] = [:]
        for row in rows.sorted(by: { ($0.hour, $0.product, $0.model, $0.long ? 1 : 0, $0.fast ? 1 : 0) < ($1.hour, $1.product, $1.model, $1.long ? 1 : 0, $1.fast ? 1 : 0) }) {
            var value = row.value
            if let g = group(row), let factors = share[g]?[row.hour] {
                // Rounded so that the group's lines add up to its exact share.
                let counts = Counts(value)
                var kept = Counts()
                var rest = carry[g] ?? Array(repeating: 0, count: Counts.size)
                for i in 0..<Counts.size {
                    let exact = Double(counts[i]) * factors[i] + rest[i]
                    let whole = max(0, exact.rounded())
                    kept[i] = Int64(whole)
                    rest[i] = exact - whole
                }
                carry[g] = rest
                value = kept.value
                if value.requests == 0 && (!value.tokens.isZero || value.webSearches > 0) { value.requests = 1 }
            }
            guard value.requests > 0 else { continue }
            let key = BucketKey(quarter: Quarter(time: Double(row.hour) * 3600), tool: OrgUsage.tool(forProduct: row.product),
                                model: row.model, long: row.long, fast: row.fast, batch: row.product == "message_batches_api")
            out[key, default: BucketValue()].merge(value)
        }
        return out
    }

    // MARK: Storage

    private struct File: Codable {
        var format: Int
        var refreshedAt: Double?
        var fetchedAt: Double?
        var fullyFetchedAt: Double?
        var rows: [OrgRow]
    }

    /// The stored report, or an empty one when there is none or it cannot be read (the next read
    /// of the report fills it again).
    public static func load(from url: URL) -> OrgUsageStore {
        guard let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data), file.format == formatVersion else { return OrgUsageStore() }
        return OrgUsageStore(rows: file.rows, refreshedAt: file.refreshedAt, fetchedAt: file.fetchedAt, fullyFetchedAt: file.fullyFetchedAt)
    }

    public func save(to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(File(format: OrgUsageStore.formatVersion, refreshedAt: refreshedAt, fetchedAt: fetchedAt,
                                           fullyFetchedAt: fullyFetchedAt, rows: rows))
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
}

/// A line's seven counts (five kinds of tokens, requests and web searches), for working out shares.
struct Counts {
    static let size = 7
    private var values = [Int64](repeating: 0, count: Counts.size)

    init() {}

    init(_ value: BucketValue) {
        let t = value.tokens
        values = [t.input, t.output, t.cacheRead, t.cacheWrite, t.cacheWrite1h, Int64(value.requests), Int64(value.webSearches)]
    }

    subscript(i: Int) -> Int64 {
        get { values[i] }
        set { values[i] = newValue }
    }

    var value: BucketValue {
        BucketValue(tokens: Tokens(input: values[0], output: values[1], cacheRead: values[2], cacheWrite: values[3], cacheWrite1h: values[4]),
                    requests: Int(values[5]), webSearches: Int(values[6]))
    }

    /// What is left after taking `other` away, never below zero.
    func minus(_ other: Counts) -> Counts {
        var out = Counts()
        for i in 0..<Counts.size { out[i] = max(0, values[i] - other[i]) }
        return out
    }

    static func + (lhs: Counts, rhs: Counts) -> Counts {
        var out = Counts()
        for i in 0..<size { out[i] = lhs[i].addingReportingOverflow(rhs[i]).overflow ? .max : lhs[i] + rhs[i] }
        return out
    }

    static func += (lhs: inout Counts, rhs: Counts) { lhs = lhs + rhs }
}

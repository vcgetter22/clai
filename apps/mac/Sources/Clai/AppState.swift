import AppKit
import ClaiCore
import ServiceManagement

enum Page {
    case overview
    case settings
}

/// The figure next to the tally. The month by default: on a morning without usage, today's
/// figure is $0, which reads like a fault.
enum MenuBarFigure: String, CaseIterable, Identifiable {
    case month
    case today
    case icon

    var id: String { rawValue }

    var label: String {
        switch self {
        case .month: return "This month"
        case .today: return "Today"
        case .icon: return "Icon only"
        }
    }
}

/// Everything the menu bar item and the panel show. The numbers come from ClaiCore; this class
/// schedules reads, keeps settings and talks to the internet once a day if allowed.
@MainActor
final class AppState: ObservableObject {
    @Published private(set) var summary: Summary
    @Published private(set) var sources: [SourceStatus] = []
    @Published private(set) var codexLimits: RateLimits? = nil
    @Published private(set) var lastScan: Date? = nil
    @Published private(set) var scanning = false
    @Published private(set) var hasScanned = false
    @Published private(set) var update: LatestRelease? = nil
    @Published private(set) var priceList: PriceList
    @Published private(set) var plans: [Vendor: String] = [:]
    @Published private(set) var launchAtLogin = false
    @Published private(set) var loginItemNote: String? = nil
    @Published var page: Page = .overview

    /// Claude's plan limits, as Claude Code last passed them to clai's status line command.
    @Published private(set) var claudeLimits: RateLimits? = nil
    /// Whether Claude Code's status line runs clai's command.
    @Published private(set) var statusLineConnected = false
    @Published private(set) var statusLineNote: String? = nil
    /// The organization whose usage report clai reads, if any.
    @Published private(set) var org: OrgConnection? = nil
    @Published private(set) var orgBusy = false
    @Published private(set) var orgError: String? = nil
    @Published private(set) var orgFetchedAt: Date? = nil

    @Published var figure: MenuBarFigure {
        didSet {
            defaults.set(figure.rawValue, forKey: Keys.figure)
            updateTitle()
        }
    }

    /// Whether clai may ask GitHub for a newer version and getclai.vercel.app for current prices,
    /// once a day. Nothing about usage is sent.
    @Published var checkOnline: Bool {
        didSet {
            defaults.set(checkOnline, forKey: Keys.online)
            if checkOnline { checkOnlineIfDue(force: true) }
        }
    }

    private(set) var menuBarTitle: String?
    var menuBarTitleChanged: ((String?) -> Void)?

    let isSample: Bool
    private let defaults = UserDefaults.standard
    private let queue = DispatchQueue(label: "io.github.vcgetter22.clai.scan", qos: .utility)
    private let scanner: UsageScanner?
    private var pricer: Pricer
    private var scanRunning = false
    private var scanAgain = false
    private var pendingRefresh: DispatchWorkItem?
    private var watcher: LogWatcher?
    private var timers: [Timer] = []
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []
    private var lastOrgAttempt: Double?
    /// Counts connection changes, so a read of the report that was under way for an older
    /// connection is not taken in.
    private var orgGeneration = 0

    private enum Keys {
        static let figure = "menuBarFigure"
        static let online = "checkOnline"
        static let lastOnline = "lastOnlineCheck"
        static let login = "launchAtLogin"
        /// The version and place of clai when it last added its login item.
        static let loginItemFor = "loginItemFor"
        static func plan(_ vendor: Vendor) -> String { "plan." + vendor.rawValue }
    }

    /// The home folder whose logs clai reads: yours, or `CLAI_HOME` (for tests).
    static var home: String {
        if let override = ProcessInfo.processInfo.environment["CLAI_HOME"], !override.isEmpty { return override }
        return FileFinder.userHome
    }

    /// `~/Library/Application Support/clai`: the ledger and the last price list.
    static var supportFolder: URL {
        if let override = ProcessInfo.processInfo.environment["CLAI_HOME"], !override.isEmpty {
            return URL(fileURLWithPath: override + "/Library/Application Support/clai", isDirectory: true)
        }
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: FileFinder.userHome + "/Library/Application Support")
        return base.appendingPathComponent("clai", isDirectory: true)
    }

    private static var pricesFile: URL { supportFolder.appendingPathComponent("prices.json") }
    /// The organization's usage report as clai last read it.
    static var cloudFile: URL { supportFolder.appendingPathComponent("cloud.json") }
    /// The organization and its key (readable by this user only).
    static var orgFile: URL { supportFolder.appendingPathComponent("anthropic-org.json") }
    /// Claude's plan limits, written by `clai --status-line`.
    static var claudeLimitsFile: URL { supportFolder.appendingPathComponent("claude-limits.json") }
    /// Each move of Claude's weekly limit, for the estimate of the use beyond this Mac.
    static var claudeLimitsHistoryFile: URL { supportFolder.appendingPathComponent("claude-limits-history.jsonl") }
    /// The status line setting clai replaced in Claude Code's settings.
    static var statusLineFile: URL { supportFolder.appendingPathComponent("claude-status-line.json") }

    init(sample: Bool = false) {
        let list = AppState.storedPrices()
        let pricer = Pricer(list: list)
        isSample = sample
        figure = MenuBarFigure(rawValue: UserDefaults.standard.string(forKey: Keys.figure) ?? "") ?? .month
        checkOnline = UserDefaults.standard.object(forKey: Keys.online) as? Bool ?? true
        priceList = list
        self.pricer = pricer
        if sample {
            scanner = nil
            summary = SampleData.summary(pricer: pricer)
        } else {
            // The ledger is loaded on the scan queue; the first read shows what it knows at once.
            scanner = UsageScanner(home: AppState.home, ledgerURL: AppState.supportFolder.appendingPathComponent("ledger.json"),
                                   cloudURL: AppState.cloudFile, limitsHistoryURL: AppState.claudeLimitsHistoryFile)
            var days = DayResolver(timeZone: .current)
            summary = .empty(today: days.day(at: Date().timeIntervalSince1970))
        }

        // Every stored property is set from here on.
        if sample {
            sources = SampleData.sources
            codexLimits = SampleData.codexLimits
            claudeLimits = SampleData.claudeLimits
            plans = [.anthropic: "claude-max-5x", .openai: "chatgpt-pro-200"]
            hasScanned = true
            lastScan = Date().addingTimeInterval(-40)
        } else {
            var stored: [Vendor: String] = [:]
            for vendor in Vendor.allCases {
                if let id = UserDefaults.standard.string(forKey: Keys.plan(vendor)) { stored[vendor] = id }
            }
            plans = stored
            org = OrgConnection.load(from: AppState.orgFile)
            claudeLimits = ClaudeLimits.load(from: AppState.claudeLimitsFile)
        }
        updateTitle()
    }

    /// The compiled-in price list, updated by the last one fetched from getclai.vercel.app when
    /// that is newer.
    static func storedPrices() -> PriceList {
        if let data = try? Data(contentsOf: pricesFile), let list = PriceList.published(data) { return list }
        return .builtIn
    }

    // MARK: Lifecycle

    func start() {
        guard !isSample else { return }
        refresh()
        // While a tool writes (every second or so during a session), read at most every 10 seconds.
        watcher = LogWatcher { [weak self] in
            MainActor.assumeIsolated { self?.refreshSoon(after: 10) }
        }

        // A safety net in case a change went unnoticed, the daily online check and the
        // organization's usage report (read every 30 minutes; Anthropic updates it a few hours late).
        addTimer(every: 300) { $0.refresh() }
        addTimer(every: 3600) { $0.checkOnlineIfDue() }
        addTimer(every: 600) { $0.syncOrgIfDue() }
        observe(NSWorkspace.shared.notificationCenter, NSWorkspace.didWakeNotification) { state in
            state.refreshSoon(after: 5)
            state.syncOrgIfDue()
        }
        observe(NotificationCenter.default, .NSCalendarDayChanged) { $0.refresh() }
        observe(NotificationCenter.default, .NSSystemTimeZoneDidChange) { state in
            NSTimeZone.resetSystemTimeZone()
            state.refresh()
        }
        checkOnlineIfDue()
        restoreLoginItem()
        readStatusLine()
        syncOrgIfDue()
    }

    private func addTimer(every seconds: TimeInterval, _ action: @escaping @MainActor (AppState) -> Void) {
        let timer = Timer(timeInterval: seconds, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                action(self)
            }
        }
        timer.tolerance = seconds / 5
        RunLoop.main.add(timer, forMode: .common)
        timers.append(timer)
    }

    private func observe(_ center: NotificationCenter, _ name: Notification.Name, _ action: @escaping @MainActor (AppState) -> Void) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                action(self)
            }
        }
        observers.append((center, token))
    }

    /// The panel opened: read the logs unless that happened a moment ago.
    func panelOpened() {
        if let lastScan, Date().timeIntervalSince(lastScan) < 15 { return }
        refresh()
    }

    // MARK: Reading the logs

    /// Reads what is new in the logs. Reads run one at a time on a background queue; a request
    /// during a read runs once more after it.
    func refresh() {
        guard let scanner else { return }
        if scanRunning {
            scanAgain = true
            return
        }
        scanRunning = true
        scanning = true
        let pricer = self.pricer
        let firstRead = !hasScanned
        queue.async {
            if firstRead {
                // What the ledger already knows, while the logs are read (that can take a few seconds).
                let stored = scanner.storedSummary(pricer: pricer, now: Date(), timeZone: TimeZone.current)
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { self.showStored(stored) }
                }
            }
            let result = scanner.refresh(pricer: pricer, now: Date(), timeZone: TimeZone.current)
            let folders = scanner.watchedFolders
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self.finish(result, watching: folders) }
            }
        }
    }

    /// Reads in a few seconds. Requests in the meantime join that read, so a tool that writes
    /// continuously still gets its usage shown every few seconds.
    func refreshSoon(after seconds: Double) {
        guard pendingRefresh == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                self?.pendingRefresh = nil
                self?.refresh()
            }
        }
        pendingRefresh = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func showStored(_ stored: Summary) {
        guard !hasScanned, stored != summary else { return }
        summary = stored
        updateTitle()
    }

    private func finish(_ result: ScanResult, watching folders: [String]) {
        if result.summary != summary { summary = result.summary }
        if result.sources != sources { sources = result.sources }
        if result.codexLimits != codexLimits { codexLimits = result.codexLimits }
        let fetched = result.cloudFetchedAt.map { Date(timeIntervalSince1970: $0) }
        if org != nil, fetched != orgFetchedAt { orgFetchedAt = fetched }
        // clai's status line command writes the limits while Claude Code runs, and its logs change then too.
        let limits = ClaudeLimits.load(from: AppState.claudeLimitsFile)
        if limits != claudeLimits { claudeLimits = limits }
        lastScan = Date()
        hasScanned = true
        scanning = false
        scanRunning = false
        updateTitle()
        watcher?.watch(folders)
        if scanAgain {
            scanAgain = false
            refresh()
        }
    }

    private func updateTitle() {
        var title: String?
        if !summary.isEmpty {
            switch figure {
            case .month: title = Format.usdShort(summary.monthCost, unpriced: summary.monthUnpriced)
            case .today: title = Format.usdShort(summary.todayCost, unpriced: summary.todayUnpriced)
            case .icon: title = nil
            }
        }
        guard title != menuBarTitle else { return }
        menuBarTitle = title
        menuBarTitleChanged?(title)
    }

    // MARK: Plans

    func plan(for vendor: Vendor) -> Plan? {
        guard let id = plans[vendor] else { return nil }
        return priceList.plans.first { $0.id == id }
    }

    func setPlan(_ id: String?, for vendor: Vendor) {
        plans[vendor] = id
        defaults.set(id, forKey: Keys.plan(vendor))
    }

    // MARK: Claude in the cloud: an organization's usage report

    /// Checks the key with a day of the report, then keeps it and reads the rest.
    func connectOrg(key: String, onlyEmail: String) {
        let key = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty, !orgBusy, !isSample else { return }
        let email = OrgConnection.clean(onlyEmail)
        orgBusy = true
        orgError = nil
        orgGeneration += 1
        let client = OrgUsageClient(key: key, userAgent: AppState.userAgent)
        Task { @MainActor in
            do {
                let now = Date().timeIntervalSince1970
                _ = try await client.usage(from: now - 86_400, to: now, onlyEmail: email, now: now)
                let connection = OrgConnection(key: key, onlyEmail: email)
                try connection.save(to: AppState.orgFile)
                org = connection
                orgBusy = false
                syncOrgIfDue(force: true)
            } catch {
                orgBusy = false
                orgError = AppState.describe(error)
            }
        }
    }

    func disconnectOrg() {
        orgGeneration += 1
        org = nil
        orgError = nil
        orgFetchedAt = nil
        orgBusy = false
        try? FileManager.default.removeItem(at: AppState.orgFile)
        guard let scanner else { return }
        queue.async {
            scanner.clearCloud()
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self.refresh() }
            }
        }
    }

    /// Counts one person's usage only (their e-mail address in the organization), or everyone's.
    func setOrgEmail(_ email: String) {
        guard var connection = org else { return }
        connection.onlyEmail = OrgConnection.clean(email)
        guard connection != org else { return }
        try? connection.save(to: AppState.orgFile)
        org = connection
        orgGeneration += 1
        orgBusy = false
        // What is stored was read for someone else: read it all again.
        if let scanner { queue.async { scanner.clearCloud() } }
        syncOrgIfDue(force: true)
    }

    /// Reads the report when due: every 30 minutes the last three days, twice a day all of last
    /// month and this one (late usage and corrections arrive for days).
    func syncOrgIfDue(force: Bool = false) {
        guard let connection = org, let scanner, !isSample, !orgBusy else { return }
        let now = Date().timeIntervalSince1970
        if !force, let last = lastOrgAttempt, now - last < 29 * 60 { return }
        lastOrgAttempt = now
        orgBusy = true
        let generation = orgGeneration
        let client = OrgUsageClient(key: connection.key, userAgent: AppState.userAgent)
        let queue = self.queue
        Task { @MainActor in
            let range = await withCheckedContinuation { (continuation: CheckedContinuation<(start: Double, end: Double, full: Bool), Never>) in
                queue.async { continuation.resume(returning: scanner.cloud.nextRange(now: now)) }
            }
            do {
                let result = try await client.usage(from: range.start, to: range.end, onlyEmail: connection.onlyEmail, now: now)
                guard generation == orgGeneration else { return }
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    queue.async {
                        scanner.updateCloud(from: range.start, to: range.end, rows: result.rows, refreshedAt: result.refreshedAt, at: now, full: range.full)
                        continuation.resume()
                    }
                }
                guard generation == orgGeneration else { return }
                orgBusy = false
                orgError = nil
                orgFetchedAt = Date(timeIntervalSince1970: now)
                refresh()
            } catch {
                guard generation == orgGeneration else { return }
                orgBusy = false
                orgError = AppState.describe(error)
            }
        }
    }

    private static var userAgent: String { "clai/\(AppVersion.current) (https://getclai.vercel.app)" }

    private static func describe(_ error: Error) -> String {
        (error as? OrgUsageError ?? .offline(error.localizedDescription)).message
    }

    // MARK: Claude in the cloud: plan limits through Claude Code's status line

    /// Claude Code's user settings, unless they are a link into a folder macOS guards (reading
    /// it would make macOS ask for access).
    private static func claudeSettingsPath() -> String? {
        let path = ClaudeStatusLine.settingsPath(home: home)
        var info = stat()
        if lstat(path, &info) == 0 { return FileFinder.isSafe(path) ? path : nil }
        let folder = (path as NSString).deletingLastPathComponent
        if lstat(folder, &info) == 0 { return FileFinder.isSafe(folder) ? path : nil }
        return FileFinder.isSafe(home) ? path : nil
    }

    /// Whether Claude Code's status line runs clai; points it at this copy of clai when clai moved.
    private func readStatusLine() {
        guard let path = AppState.claudeSettingsPath() else { return }
        let text = try? String(contentsOfFile: path, encoding: .utf8)
        let current = ClaudeStatusLine.currentCommand(in: text)
        statusLineConnected = ClaudeStatusLine.isClai(current)
        if statusLineConnected, AppVersion.isInApplications, let executable = Bundle.main.executablePath,
           current != ClaudeStatusLine.command(executable: executable) {
            connectStatusLine()
        }
    }

    func connectStatusLine() {
        guard !isSample, let executable = Bundle.main.executablePath else { return }
        guard let path = AppState.claudeSettingsPath() else {
            statusLineNote = "Claude Code's settings file is in a folder macOS protects, so clai leaves it alone."
            return
        }
        // A missing file is created; one that exists but cannot be read is never written over.
        var text: String?
        if FileManager.default.fileExists(atPath: path) {
            guard let read = try? String(contentsOfFile: path, encoding: .utf8) else {
                statusLineNote = "clai could not read ~/.claude/settings.json, so it leaves it alone."
                return
            }
            text = read
        }
        do {
            let (updated, installed) = try ClaudeStatusLine.connect(executable: executable, settings: text,
                                                                     remembered: ClaudeStatusLine.Installed.load(from: AppState.statusLineFile))
            // What it replaced is saved first, so clai's command can run it from the first update on.
            try installed.save(to: AppState.statusLineFile)
            try AppState.writeSettings(updated, to: path)
            statusLineConnected = true
            statusLineNote = nil
        } catch ClaudeStatusLine.EditError.notAnObject {
            statusLineNote = "~/.claude/settings.json is not plain JSON, so clai leaves it alone."
        } catch {
            statusLineNote = "clai could not change ~/.claude/settings.json: \(error.localizedDescription)"
        }
    }

    func disconnectStatusLine() {
        if let path = AppState.claudeSettingsPath(), FileManager.default.fileExists(atPath: path) {
            guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
                statusLineNote = "clai could not read ~/.claude/settings.json, so it changed nothing."
                return
            }
            // Nil when the status line is no longer clai's: then the user's setting stays as it is.
            if let restored = ClaudeStatusLine.disconnect(settings: text, remembered: ClaudeStatusLine.Installed.load(from: AppState.statusLineFile)) {
                do {
                    try AppState.writeSettings(restored, to: path)
                } catch {
                    statusLineNote = "clai could not change ~/.claude/settings.json: \(error.localizedDescription)"
                    return
                }
            }
        }
        try? FileManager.default.removeItem(at: AppState.statusLineFile)
        try? FileManager.default.removeItem(at: AppState.claudeLimitsFile)
        try? FileManager.default.removeItem(at: AppState.claudeLimitsHistoryFile)
        claudeLimits = nil
        refresh()
        statusLineConnected = false
        statusLineNote = nil
    }

    /// Writes Claude Code's settings in place of the file a link points to, so a linked settings
    /// file (dotfiles) stays a link.
    private static func writeSettings(_ text: String, to path: String) throws {
        let target = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: target, atomically: true, encoding: .utf8)
    }

    // MARK: Online, once a day

    private func checkOnlineIfDue(force: Bool = false) {
        guard checkOnline, !isSample else { return }
        let last = defaults.double(forKey: Keys.lastOnline)
        guard force || Date().timeIntervalSince1970 - last > 20 * 3600 else { return }
        // Marked done only when an answer arrives, so a Mac that starts offline tries again within the hour.
        Online.get(Online.pricesURL) { [weak self] data in
            guard let self else { return }
            self.defaults.set(Date().timeIntervalSince1970, forKey: Keys.lastOnline)
            guard let list = PriceList.published(data), list.version > self.priceList.version else { return }
            try? FileManager.default.createDirectory(at: AppState.supportFolder, withIntermediateDirectories: true)
            try? data.write(to: AppState.pricesFile, options: .atomic)
            self.priceList = list
            self.pricer = Pricer(list: list)
            self.refresh()
        }
        Online.get(LatestRelease.endpoint) { [weak self] data in
            guard let self, let release = LatestRelease.parse(data) else { return }
            self.update = release.isNewer(than: AppVersion.current) ? release : nil
        }
    }

    // MARK: Open at login

    func setLaunchAtLogin(_ on: Bool) {
        defaults.set(on, forKey: Keys.login)
        do {
            if on {
                try SMAppService.mainApp.register()
                defaults.set(AppState.loginItemIdentity, forKey: Keys.loginItemFor)
            } else {
                try SMAppService.mainApp.unregister()
            }
            loginItemNote = nil
        } catch {
            loginItemNote = "macOS did not allow it: \(error.localizedDescription)"
        }
        readLoginItem()
    }

    func openLoginItemSettings() {
        SMAppService.openSystemSettingsLoginItems()
    }

    private func readLoginItem() {
        DispatchQueue.global(qos: .utility).async {
            let status = SMAppService.mainApp.status
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self.launchAtLogin = status == .enabled
                    if status == .requiresApproval {
                        self.loginItemNote = "Allow clai in System Settings → General → Login Items."
                    }
                }
            }
        }
    }

    private static var loginItemIdentity: String { AppVersion.current + " " + Bundle.main.bundlePath }

    /// An update or a move can drop the login item; put it back then. A login item the user removed
    /// in System Settings stays removed.
    private func restoreLoginItem() {
        guard defaults.bool(forKey: Keys.login), AppVersion.isInApplications else {
            readLoginItem()
            return
        }
        let identity = AppState.loginItemIdentity
        let changed = defaults.string(forKey: Keys.loginItemFor) != identity
        DispatchQueue.global(qos: .utility).async {
            let before = SMAppService.mainApp.status
            let added = before != .enabled && before != .requiresApproval && changed
                && (try? SMAppService.mainApp.register()) != nil
            let status = added ? SMAppService.mainApp.status : before
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    if added { self.defaults.set(identity, forKey: Keys.loginItemFor) }
                    if status != .enabled && status != .requiresApproval && !changed {
                        self.defaults.set(false, forKey: Keys.login)
                    }
                    self.readLoginItem()
                }
            }
        }
    }
}

/// The two requests clai makes, once a day and only when allowed: the price list and the latest
/// release. No usage data is sent.
enum Online {
    static let pricesURL = URL(string: "https://getclai.vercel.app/prices.json")!

    static func get(_ url: URL, _ done: @escaping @MainActor (Data) -> Void) {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("clai/\(AppVersion.current) (Mac)", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard let data, (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { done(data) }
            }
        }.resume()
    }
}

/// The organization whose usage report clai reads: its Admin API key (Claude Console) or Analytics
/// API key (Claude Enterprise), and whose usage to count. Kept in `anthropic-org.json`, readable by
/// this user only; clai uses the key for nothing but `GET /v1/organizations/analytics/usage`.
struct OrgConnection: Codable, Equatable {
    var key: String
    /// Count only the usage attributed to this address; nil for the whole organization.
    var onlyEmail: String?

    /// The key's last four characters, to tell keys apart.
    var keyHint: String { "…" + key.suffix(4) }

    static func clean(_ email: String) -> String? {
        let value = email.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    static func load(from url: URL) -> OrgConnection? {
        guard let data = try? Data(contentsOf: url), let connection = try? JSONDecoder().decode(OrgConnection.self, from: data),
              !connection.key.isEmpty else { return nil }
        return connection
    }

    func save(to url: URL) throws {
        let files = FileManager.default
        try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
        try files.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

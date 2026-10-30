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

    private enum Keys {
        static let figure = "menuBarFigure"
        static let online = "checkOnline"
        static let lastOnline = "lastOnlineCheck"
        static let login = "launchAtLogin"
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
            var days = DayResolver(timeZone: .current)
            summary = SampleData.summary(today: days.day(at: Date().timeIntervalSince1970), pricer: pricer)
        } else {
            let scanner = UsageScanner(home: AppState.home, ledgerURL: AppState.supportFolder.appendingPathComponent("ledger.json"))
            self.scanner = scanner
            // What the ledger already knows shows at once; the first read follows.
            summary = scanner.storedSummary(pricer: pricer)
        }

        // Every stored property is set from here on.
        if sample {
            sources = SampleData.sources
            codexLimits = SampleData.codexLimits
            plans = [.anthropic: "claude-max-5x", .openai: "chatgpt-pro-200"]
            hasScanned = true
            lastScan = Date().addingTimeInterval(-40)
        } else {
            var stored: [Vendor: String] = [:]
            for vendor in Vendor.allCases {
                if let id = UserDefaults.standard.string(forKey: Keys.plan(vendor)) { stored[vendor] = id }
            }
            plans = stored
        }
        updateTitle()
    }

    /// The newer of the compiled-in price list and the last one fetched from getclai.vercel.app.
    static func storedPrices() -> PriceList {
        if let data = try? Data(contentsOf: pricesFile), let list = PriceList.decode(data), list.version > PriceList.builtIn.version {
            return list
        }
        return .builtIn
    }

    // MARK: Lifecycle

    func start() {
        guard !isSample else { return }
        refresh()
        watcher = LogWatcher { [weak self] in
            MainActor.assumeIsolated { self?.refreshSoon(after: 3) }
        }

        // A safety net in case a change went unnoticed, and the daily online check.
        addTimer(every: 300) { $0.refresh() }
        addTimer(every: 3600) { $0.checkOnlineIfDue() }
        observe(NSWorkspace.shared.notificationCenter, NSWorkspace.didWakeNotification) { $0.refreshSoon(after: 5) }
        observe(NotificationCenter.default, .NSCalendarDayChanged) { $0.refresh() }
        observe(NotificationCenter.default, .NSSystemTimeZoneDidChange) { state in
            NSTimeZone.resetSystemTimeZone()
            state.refresh()
        }
        checkOnlineIfDue()
        restoreLoginItem()
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
        queue.async {
            let result = scanner.refresh(pricer: pricer, now: Date(), timeZone: TimeZone.current)
            let folders = scanner.watchedFolders
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self.finish(result, watching: folders) }
            }
        }
    }

    func refreshSoon(after seconds: Double) {
        pendingRefresh?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.refresh() }
        }
        pendingRefresh = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func finish(_ result: ScanResult, watching folders: [String]) {
        if result.summary != summary { summary = result.summary }
        if result.sources != sources { sources = result.sources }
        if result.codexLimits != codexLimits { codexLimits = result.codexLimits }
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
            case .month: title = Format.usdShort(summary.monthCost)
            case .today: title = Format.usdShort(summary.todayCost)
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

    // MARK: Online, once a day

    private func checkOnlineIfDue(force: Bool = false) {
        guard checkOnline, !isSample else { return }
        let last = defaults.double(forKey: Keys.lastOnline)
        guard force || Date().timeIntervalSince1970 - last > 20 * 3600 else { return }
        defaults.set(Date().timeIntervalSince1970, forKey: Keys.lastOnline)
        Online.get(Online.pricesURL) { [weak self] data in
            guard let self, let list = PriceList.decode(data), list.version > self.priceList.version else { return }
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

    /// An update gives clai a new signature, which can drop its login item; put it back.
    private func restoreLoginItem() {
        guard defaults.bool(forKey: Keys.login), AppVersion.isInApplications else {
            readLoginItem()
            return
        }
        DispatchQueue.global(qos: .utility).async {
            let status = SMAppService.mainApp.status
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    if status != .enabled && status != .requiresApproval { try? SMAppService.mainApp.register() }
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

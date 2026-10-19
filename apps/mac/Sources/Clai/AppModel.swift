import AppKit
import ClaiKit
import Foundation
import Observation
import SwiftUI

enum Page {
    case overview
    case settings
}

enum BreakdownTab: String, CaseIterable, Identifiable {
    case tools = "Tools"
    case models = "Models"
    case projects = "Projects"
    case tips = "Tips"

    var id: String { rawValue }
}

/// Everything the menu bar item and the panel show, and the actions behind their buttons.
/// The numbers come from the bundled engine (`clai snapshot --scan`); nothing is computed here.
@MainActor
@Observable
final class AppModel {
    enum Status: Equatable {
        case starting
        case ready
        case failed(String)
    }

    static let shared = AppModel.fromLaunchArguments(CommandLine.arguments)

    let prefs: Preferences
    let isDemo: Bool
    let appVersion: String

    private(set) var snapshot: Snapshot?
    private(set) var status: Status = .starting
    private(set) var isRefreshing = false
    private(set) var lastUpdated: Date?
    /// The last refresh failed while an older snapshot is still on screen.
    private(set) var staleReason: String?
    private(set) var watchedPaths: [String] = []
    private(set) var availableUpdate: LatestRelease?
    private(set) var launchAtLogin = LoginItem.isEnabled

    var page: Page = .overview
    var breakdown: BreakdownTab = .tools
    /// A failed action (plan, budget, dashboard), shown in the panel until dismissed.
    var actionMessage: String?
    private(set) var busy = false

    private let engine: Engine?
    private let watcher = LogWatcher()
    private let dashboard = DashboardLauncher()
    @ObservationIgnored private var refreshQueued = false
    @ObservationIgnored private var lastEngineRun: Date?
    @ObservationIgnored private var timerTask: Task<Void, Never>?
    @ObservationIgnored private var liveTask: Task<Void, Never>?
    @ObservationIgnored private var lastUpdateCheck: Date?
    @ObservationIgnored private var started = false

    init(engine: Engine?, prefs: Preferences = Preferences(), demo: Snapshot? = nil) {
        self.engine = engine
        self.prefs = prefs
        self.isDemo = demo != nil
        self.appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        if let demo {
            snapshot = demo
            status = .ready
            lastUpdated = Date().addingTimeInterval(-90)
            watchedPaths = demo.scan?.watchPaths ?? []
        }
    }

    /// `--demo` (and `--render`, `--window`) show the bundled sample snapshot instead of this Mac's data.
    static func fromLaunchArguments(_ arguments: [String]) -> AppModel {
        let wantsDemo = arguments.contains("--demo") || arguments.contains("--render") || arguments.contains("--window")
        if wantsDemo, let demo = loadDemoSnapshot() {
            return AppModel(engine: nil, demo: demo)
        }
        let environment = ProcessInfo.processInfo.environment
        let location = EngineLocation.find(bundleURL: Bundle.main.bundleURL, environment: environment)
        return AppModel(engine: location.map { Engine(location: $0, environment: environment) })
    }

    private static func loadDemoSnapshot() -> Snapshot? {
        let path = ProcessInfo.processInfo.environment["CLAI_DEMO_SNAPSHOT"]
        let url = path.map { URL(fileURLWithPath: $0) } ?? Bundle.main.url(forResource: "demo-snapshot", withExtension: "json")
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? Snapshot.decode(data)
    }

    // MARK: Lifecycle

    func start() {
        guard !started, !isDemo else { return }
        started = true
        guard engine != nil else {
            status = .failed(EngineError.notFound.errorDescription ?? "")
            return
        }
        watcher.onChange = { [weak self] in
            Task { @MainActor [weak self] in self?.logsChanged() }
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in await self?.refresh() }
        }
        Task { await refresh() }
        scheduleTimer()
        checkForUpdateIfDue()
    }

    func shutdown() {
        timerTask?.cancel()
        liveTask?.cancel()
        watcher.stop()
        dashboard.stop()
    }

    /// The panel opened: refresh if what it shows is more than a minute old.
    func panelOpened() {
        guard !isDemo else { return }
        if let lastUpdated, Date().timeIntervalSince(lastUpdated) < 60 { return }
        Task { await refresh() }
    }

    // MARK: Refreshing

    /// One engine run at a time; a request that arrives during a run triggers one more afterwards.
    func refresh() async {
        guard let engine, !isDemo else { return }
        if isRefreshing {
            refreshQueued = true
            return
        }
        isRefreshing = true
        repeat {
            refreshQueued = false
            lastEngineRun = Date()
            do {
                let next = try await engine.snapshot(scan: true)
                withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                    snapshot = next
                }
                status = .ready
                staleReason = nil
                lastUpdated = Date()
                updateWatcher(next)
            } catch {
                let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                if snapshot == nil { status = .failed(message) } else { staleReason = message }
            }
        } while refreshQueued
        isRefreshing = false
    }

    func setPrefersLiveUpdates(_ on: Bool) {
        prefs.liveUpdates = on
        if on, let snapshot { updateWatcher(snapshot) } else { watcher.stop(); watchedPaths = [] }
    }

    func setRefreshMinutes(_ minutes: Int) {
        prefs.refreshMinutes = minutes
        scheduleTimer()
    }

    private func scheduleTimer() {
        timerTask?.cancel()
        let minutes = prefs.refreshMinutes
        timerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(minutes) * 60 * 1_000_000_000)
                guard !Task.isCancelled else { return }
                await self?.refresh()
                self?.checkForUpdateIfDue()
            }
        }
    }

    private func updateWatcher(_ snapshot: Snapshot) {
        guard prefs.liveUpdates else { return }
        watchedPaths = watcher.watch(snapshot.scan?.watchPaths ?? [])
    }

    /// A log changed. Claude Code writes while it streams, so refresh shortly after the first
    /// change and at most every 15 seconds while a session is busy.
    private func logsChanged() {
        guard prefs.liveUpdates, liveTask == nil else { return }
        liveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if let last = self?.lastEngineRun {
                let wait = 15 - Date().timeIntervalSince(last)
                if wait > 0 { try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }
            }
            guard !Task.isCancelled else { return }
            self?.liveTask = nil
            await self?.refresh()
        }
    }

    // MARK: Updates

    private func checkForUpdateIfDue() {
        guard prefs.checkForUpdates, !isDemo else { return }
        if let last = lastUpdateCheck, Date().timeIntervalSince(last) < 86_400 { return }
        lastUpdateCheck = Date()
        let installed = appVersion
        Task { [weak self] in
            var request = URLRequest(url: LatestRelease.endpoint)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("clai-mac/\(installed)", forHTTPHeaderField: "User-Agent")
            request.timeoutInterval = 15
            guard let response = try? await URLSession.shared.data(for: request),
                  let release = LatestRelease.parse(response.0), release.isNewer(than: installed) else { return }
            self?.availableUpdate = release
        }
    }

    /// Why the first snapshot could not be read, if it could not.
    var failureMessage: String? {
        if case .failed(let message) = status { return message }
        return nil
    }

    // MARK: Menu bar

    var menuBarTitle: String {
        guard let snapshot else { return status == .starting && !isDemo ? "…" : "" }
        switch prefs.menuBarDisplay {
        case .today: return Format.usdShort(snapshot.today.usd)
        case .month: return Format.usdShort(snapshot.month.usd)
        case .iconOnly: return ""
        }
    }

    // MARK: Actions

    func openDashboard(page: String = "overview") {
        guard let engine else {
            actionMessage = isDemo ? "The dashboard is not available with sample data." : EngineError.notFound.errorDescription
            return
        }
        Task {
            do {
                try await dashboard.open(engine: engine, page: page)
                NSApp.keyWindow?.close()
            } catch {
                actionMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func setPlan(_ option: Snapshot.PlanOption) async {
        await perform { try await $0.setPlan(provider: option.provider, plan: option.plan) }
    }

    func removePlan(_ plan: Snapshot.Plan) async {
        await perform { try await $0.removePlan(id: plan.id) }
    }

    func setBudget(_ amount: Double) async {
        await perform { try await $0.setBudget(name: "Monthly", amountUsd: amount, id: "monthly") }
    }

    func removeBudget(_ budget: Snapshot.Budget) async {
        await perform { try await $0.removeBudget(id: budget.id) }
    }

    func setLaunchAtLogin(_ on: Bool) {
        do {
            try LoginItem.set(on)
        } catch {
            actionMessage = "macOS did not change the login item: \(error.localizedDescription)"
        }
        launchAtLogin = LoginItem.isEnabled
    }

    var dataFolder: URL {
        if let home = ProcessInfo.processInfo.environment["CLAI_HOME"], !home.isEmpty { return URL(fileURLWithPath: home) }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".clai")
    }

    func revealDataFolder() {
        NSWorkspace.shared.activateFileViewerSelecting([dataFolder])
    }

    func quit() {
        NSApp.terminate(nil)
    }

    private func perform(_ action: (Engine) async throws -> Void) async {
        guard let engine else {
            actionMessage = isDemo ? "Settings are read-only with sample data." : EngineError.notFound.errorDescription
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await action(engine)
            await refresh()
        } catch {
            actionMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

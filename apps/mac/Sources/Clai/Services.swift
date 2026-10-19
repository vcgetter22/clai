import AppKit
import ClaiKit
import CoreServices
import Foundation
import Observation
import ServiceManagement

// MARK: - Menu bar icon

enum MenuBarIcon {
    /// The clai tally (four strokes and a diagonal) as a template image, so it follows the menu bar's colour.
    static let tally: NSImage = {
        let image = NSImage(size: NSSize(width: 18, height: 15), flipped: false) { _ in
            NSColor.black.setStroke()
            let path = NSBezierPath()
            path.lineWidth = 1.7
            path.lineCapStyle = .round
            for index in 0..<4 {
                let x = 3.6 + CGFloat(index) * 3.3
                path.move(to: NSPoint(x: x, y: 2.5))
                path.line(to: NSPoint(x: x, y: 12.5))
            }
            path.move(to: NSPoint(x: 1.6, y: 3.6))
            path.line(to: NSPoint(x: 16.4, y: 11.4))
            path.stroke()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "clai"
        return image
    }()
}

// MARK: - Preferences

/// The figure next to the tally. The month by default: the panel's headline, and never a bare $0
/// on a morning without usage yet.
enum MenuBarDisplay: String, CaseIterable, Identifiable {
    case month
    case today
    case iconOnly

    var id: String { rawValue }

    var label: String {
        switch self {
        case .today: return "Today"
        case .month: return "This month"
        case .iconOnly: return "Icon only"
        }
    }
}

@MainActor
@Observable
final class Preferences {
    private enum Key {
        static let display = "menuBarDisplay"
        static let refresh = "refreshMinutes"
        static let live = "liveUpdates"
        static let updates = "checkForUpdates"
    }

    private let defaults: UserDefaults

    var menuBarDisplay: MenuBarDisplay {
        didSet { defaults.set(menuBarDisplay.rawValue, forKey: Key.display) }
    }

    /// Minutes between scheduled refreshes; live updates come on top.
    var refreshMinutes: Int {
        didSet { defaults.set(refreshMinutes, forKey: Key.refresh) }
    }

    /// Watch the tools' log folders and refresh as they change.
    var liveUpdates: Bool {
        didSet { defaults.set(liveUpdates, forKey: Key.live) }
    }

    /// Ask GitHub once a day whether a newer clai for Mac exists. Sends no usage data.
    var checkForUpdates: Bool {
        didSet { defaults.set(checkForUpdates, forKey: Key.updates) }
    }

    static let refreshChoices = [1, 5, 15, 30, 60]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        menuBarDisplay = MenuBarDisplay(rawValue: defaults.string(forKey: Key.display) ?? "") ?? .month
        let minutes = defaults.integer(forKey: Key.refresh)
        refreshMinutes = Preferences.refreshChoices.contains(minutes) ? minutes : 5
        liveUpdates = defaults.object(forKey: Key.live) as? Bool ?? true
        checkForUpdates = defaults.object(forKey: Key.updates) as? Bool ?? true
    }
}

// MARK: - Open at login

enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    static func set(_ enabled: Bool) throws {
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }
}

// MARK: - Log watcher

/// Watches the folders the tools write their usage logs to (FSEvents, recursive) and reports
/// that something changed. clai decides when to refresh; this only says "something moved".
final class LogWatcher: @unchecked Sendable {
    private var stream: FSEventStreamRef?
    private var paths: [String] = []
    private let queue = DispatchQueue(label: "clai.log-watcher")
    var onChange: (@Sendable () -> Void)?

    /// Watch `paths` that exist; returns the ones actually watched.
    @discardableResult
    func watch(_ candidates: [String]) -> [String] {
        let existing = candidates.filter { FileManager.default.fileExists(atPath: $0) }.sorted()
        if existing == paths, stream != nil { return existing }
        stop()
        guard !existing.isEmpty else { return [] }
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            Unmanaged<LogWatcher>.fromOpaque(info).takeUnretainedValue().onChange?()
        }
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagFileEvents)
        guard let created = FSEventStreamCreate(kCFAllocatorDefault, callback, &context, existing as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 2.0, flags) else { return [] }
        FSEventStreamSetDispatchQueue(created, queue)
        FSEventStreamStart(created)
        stream = created
        paths = existing
        return existing
    }

    func stop() {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
        paths = []
    }

    deinit { stop() }
}

// MARK: - Local dashboard

/// Starts `clai dashboard` on 127.0.0.1 when asked and opens it in the browser. One server per
/// app run; it stops when clai quits. An already running clai dashboard is reused.
@MainActor
final class DashboardLauncher {
    enum LaunchError: LocalizedError {
        case noFreePort
        case didNotStart

        var errorDescription: String? {
            switch self {
            case .noFreePort: return "Ports 4321 to 4330 are all taken by other programs."
            case .didNotStart: return "The dashboard did not start. Try again, or run `npx @claii/cli dashboard` in Terminal."
            }
        }
    }

    private enum Probe {
        case clai, busy, free
    }

    private var process: Process?
    private var port: Int?

    func open(engine: Engine, page: String = "overview") async throws {
        if let port, process?.isRunning == true {
            browse(port, page)
            return
        }
        for candidate in 4321...4330 {
            switch await probe(candidate) {
            case .clai:
                port = candidate
                browse(candidate, page)
                return
            case .busy:
                continue
            case .free:
                try start(engine, candidate)
                for _ in 0..<50 {
                    try await Task.sleep(nanoseconds: 200_000_000)
                    if await probe(candidate) == .clai {
                        browse(candidate, page)
                        return
                    }
                    if process?.isRunning != true { break }
                }
                throw LaunchError.didNotStart
            }
        }
        throw LaunchError.noFreePort
    }

    /// Stop the server synchronously (used when the app quits).
    func stop() {
        guard let process, process.isRunning else { return }
        let pid = process.processIdentifier
        process.terminate()
        let deadline = Date().addingTimeInterval(0.6)
        while process.isRunning && Date() < deadline { usleep(20_000) }
        if process.isRunning { kill(pid, SIGKILL) }
        self.process = nil
    }

    private func start(_ engine: Engine, _ port: Int) throws {
        let server = Process()
        server.executableURL = engine.location.node
        server.arguments = engine.dashboardArguments(port: port)
        server.environment = engine.environment
        server.standardInput = FileHandle.nullDevice
        server.standardOutput = FileHandle.nullDevice
        server.standardError = FileHandle.nullDevice
        try server.run()
        process = server
        self.port = port
    }

    private func browse(_ port: Int, _ page: String) {
        if let url = URL(string: "http://127.0.0.1:\(port)/#/\(page)") { NSWorkspace.shared.open(url) }
    }

    private func probe(_ port: Int) async -> Probe {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else { return .busy }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.8
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  json["mode"] as? String == "local" else { return .busy }
            return .clai
        } catch let error as URLError where error.code == .cannotConnectToHost || error.code == .networkConnectionLost {
            return .free
        } catch {
            return .busy
        }
    }
}

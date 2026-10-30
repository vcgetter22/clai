import AppKit
import ClaiCore

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// A second copy of clai asks the running one to show its window, then quits.
    static let showWindowNotification = Notification.Name("io.github.vcgetter22.clai.show-window")

    private var state: AppState?
    private var statusItem: StatusItemController?
    private let window = PanelWindowController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = CommandLine.arguments
        if let index = arguments.firstIndex(of: "--render"), index + 1 < arguments.count {
            Renderer.render(to: URL(fileURLWithPath: arguments[index + 1], isDirectory: true))
            exit(0)
        }
        let sample = arguments.contains("--sample")
        if !sample && handOffToRunningCopy() {
            NSApp.terminate(nil)
            return
        }

        NSApp.mainMenu = MainMenu.make()
        let state = AppState(sample: sample)
        self.state = state
        statusItem = StatusItemController(state: state, openWindow: { [weak self] in
            MainActor.assumeIsolated { self?.showWindow(welcome: false) }
        })
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(showWindowFromAnotherCopy), name: Self.showWindowNotification, object: nil,
            suspensionBehavior: .deliverImmediately
        )
        state.start()

        // The first launch opens a window: a menu bar item alone is easy to miss. Later launches
        // open it too when the item cannot be seen (hidden behind the notch, or not allowed in the
        // menu bar in System Settings).
        if arguments.contains("--open-panel") {
            // For screenshots of the real panel.
            let settings = arguments.contains("--settings")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                MainActor.assumeIsolated {
                    self?.statusItem?.showPopover()
                    if settings { self?.state?.page = .settings }
                }
            }
            return
        }
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: "welcomed") || arguments.contains("--window") {
            defaults.set(true, forKey: "welcomed")
            showWindow(welcome: true)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, let item = self.statusItem, !item.looksVisible else { return }
                    self.showWindow(welcome: true)
                }
            }
        }
    }

    /// Opening clai again (Finder, Spotlight, Launchpad) shows its window, so it can always be found
    /// and quit, even when the menu bar item is hidden.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow(welcome: false)
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        statusItem?.remove()
    }

    func showWindow(welcome: Bool) {
        guard let state else { return }
        statusItem?.closePopover()
        window.show(state: state, welcome: welcome)
    }

    @objc private func showWindowFromAnotherCopy() {
        showWindow(welcome: false)
    }

    /// When clai is already running, a newer copy replaces it; any other copy hands over.
    private func handOffToRunningCopy() -> Bool {
        guard let id = Bundle.main.bundleIdentifier else { return false }
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: id)
            .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
        guard !others.isEmpty else { return false }
        let mine = AppVersion.current
        let olderOnes = others.filter { other in
            guard let url = other.bundleURL, let theirs = Bundle(url: url)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String else { return false }
            return SemanticVersion(theirs).map { theirVersion in SemanticVersion(mine).map { $0 > theirVersion } ?? false } ?? false
        }
        if olderOnes.count == others.count {
            olderOnes.forEach { $0.terminate() }
            return false
        }
        DistributedNotificationCenter.default().postNotificationName(Self.showWindowNotification, object: nil, userInfo: nil, deliverImmediately: true)
        return true
    }
}

/// The app menu, so ⌘Q, ⌘W and ⌘H work while clai is active.
enum MainMenu {
    static func make() -> NSMenu {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About clai", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide clai", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit clai", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu = windowMenu
        return main
    }
}

/// The app's version and where it runs from.
enum AppVersion {
    static var current: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    /// macOS runs a downloaded app from a temporary read-only copy until it is moved out of
    /// Downloads ("App Translocation"), and a disk image is read-only too.
    static var needsMoving: Bool {
        let path = Bundle.main.bundlePath
        return path.contains("/AppTranslocation/") || path.hasPrefix("/Volumes/")
    }

    static var isInApplications: Bool {
        let path = Bundle.main.bundlePath
        return path.hasPrefix("/Applications/") || path.hasPrefix(FileFinder.userHome + "/Applications/")
    }
}

import AppKit
import ClaiKit
import SwiftUI

@main
struct ClaiApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            PanelView()
                .environment(AppModel.shared)
        } label: {
            MenuBarLabel(model: AppModel.shared)
        }
        .menuBarExtraStyle(.window)
    }
}

/// The menu bar item: the tally and, by default, this month's spend so far.
struct MenuBarLabel: View {
    let model: AppModel

    var body: some View {
        let title = model.menuBarTitle
        if title.isEmpty {
            Image(nsImage: MenuBarIcon.tally)
        } else {
            HStack(spacing: 4) {
                Image(nsImage: MenuBarIcon.tally)
                Text(title).monospacedDigit()
            }
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// A second copy of clai asks the running one to show its window, then quits.
    static let showWindowNotification = Notification.Name("io.github.vcgetter22.clai.show-window")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = CommandLine.arguments
        let model = AppModel.shared
        if let index = arguments.firstIndex(of: "--render"), index + 1 < arguments.count {
            ExportRenderer.render(model: model, to: URL(fileURLWithPath: arguments[index + 1], isDirectory: true))
            NSApp.terminate(nil)
            return
        }
        if arguments.contains("--window") {
            let window = PanelWindow.show(model: model, intro: false, inDock: false)
            print("CLAI_WINDOW_ID=\(window.windowNumber)")
            fflush(stdout)
        }
        if !model.isDemo && !Self.isOnlyInstance() {
            NSApp.terminate(nil)
            return
        }
        model.start()
        if !model.isDemo {
            DistributedNotificationCenter.default().addObserver(forName: Self.showWindowNotification, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { _ = PanelWindow.show(model: AppModel.shared) }
            }
            // The first launch opens a window: a menu bar item alone is easy to miss, and can sit
            // behind the notch when the menu bar is full. (`--open-panel` is for screenshots.)
            if !model.prefs.shownWindowIntro && !arguments.contains("--open-panel") {
                model.prefs.shownWindowIntro = true
                PanelWindow.show(model: model)
            }
        }
        if arguments.contains("--open-panel") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { StatusItemOpener.open() }
        }
    }

    /// Opening clai again (Finder, Spotlight, Launchpad) shows the panel in a window, so clai can
    /// always be found and quit even when its menu bar item cannot be seen.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !AppModel.shared.isDemo { PanelWindow.show(model: AppModel.shared) }
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        AppModel.shared.shutdown()
    }

    /// A second launch (another copy, say one still running from the disk image) hands over to the
    /// running copy instead of adding a second menu bar item.
    private static func isOnlyInstance() -> Bool {
        guard let id = Bundle.main.bundleIdentifier else { return true }
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: id).filter { $0 != NSRunningApplication.current }
        guard !others.isEmpty else { return true }
        DistributedNotificationCenter.default().postNotificationName(showWindowNotification, object: nil, userInfo: nil, deliverImmediately: true)
        return false
    }
}

// MARK: - Screenshots (used by CI and for the website)

/// `--render <dir>` draws the panel offscreen with the sample snapshot, light and dark, at 2x.
@MainActor
enum ExportRenderer {
    static func render(model: AppModel, to directory: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for (name, scheme) in [("light", ColorScheme.light), ("dark", ColorScheme.dark)] {
            let appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            let shape = RoundedRectangle(cornerRadius: 26, style: .continuous)
            let view = PanelView()
                .environment(model)
                .environment(\.exportRendering, true)
                .environment(\.colorScheme, scheme)
                .background(shape.fill(scheme == .dark ? Color(hex: 0x1C1F1E) : Color(hex: 0xF4F6F4)))
                .clipShape(shape)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            renderer.isOpaque = false
            var image: NSImage?
            if let appearance {
                appearance.performAsCurrentDrawingAppearance { image = renderer.nsImage }
            } else {
                image = renderer.nsImage
            }
            guard let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else { continue }
            try? png.write(to: directory.appendingPathComponent("panel-\(name).png"))
        }
    }
}

/// The panel in an ordinary window: on the first launch, whenever clai is opened again, and for
/// `--window` captures with real materials. While it is open clai has a Dock icon and the app menu
/// (Quit clai, ⌘Q); closing it puts clai back in the menu bar only.
@MainActor
enum PanelWindow {
    private static var window: NSWindow?
    private static let closer = Closer()

    @discardableResult
    static func show(model: AppModel, intro: Bool = true, inDock: Bool = true) -> NSWindow {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return window
        }
        let hosting = NSHostingView(rootView: VStack(spacing: 0) {
            if intro { WindowIntro() }
            PanelView()
        }.environment(model))
        let size = hosting.fittingSize
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: Metrics.panelWidth, height: max(400, size.height)),
            styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "clai"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        let effect = NSVisualEffectView()
        effect.material = .popover
        effect.blendingMode = .behindWindow
        effect.state = .active
        hosting.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(hosting)
        NSLayoutConstraint.activate([
            hosting.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            hosting.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            hosting.topAnchor.constraint(equalTo: effect.topAnchor),
            hosting.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
        ])
        window.contentView = effect
        if inDock {
            window.delegate = closer
            NSApp.setActivationPolicy(.regular)
        }
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        self.window = window
        return window
    }

    /// Back to a menu bar app once the window is closed.
    private final class Closer: NSObject, NSWindowDelegate {
        func windowWillClose(_ notification: Notification) {
            MainActor.assumeIsolated {
                PanelWindow.window = nil
                NSApp.setActivationPolicy(.accessory)
            }
        }
    }
}

/// The top of the window: where clai lives and how to leave it.
struct WindowIntro: View {
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(nsImage: MenuBarIcon.tally)
                .renderingMode(.template)
                .foregroundStyle(Theme.accent)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text("clai lives in your menu bar")
                    .font(.system(size: 13, weight: .semibold))
                Text("Click the tally at the top of the screen to open this panel. If the menu bar is full, macOS can hide it behind the camera notch; opening clai again brings this window back. Quit from the ⋯ menu or with ⌘Q.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .platter()
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 34)
        .frame(width: Metrics.panelWidth)
    }
}

/// `--open-panel` clicks the menu bar item once after launch (for screenshots of the real thing).
@MainActor
enum StatusItemOpener {
    static func open() {
        for window in NSApp.windows where String(describing: type(of: window)).contains("StatusBarWindow") {
            if let button = findButton(in: window.contentView) {
                button.performClick(nil)
                return
            }
        }
    }

    private static func findButton(in view: NSView?) -> NSStatusBarButton? {
        guard let view else { return nil }
        if let button = view as? NSStatusBarButton { return button }
        for subview in view.subviews {
            if let button = findButton(in: subview) { return button }
        }
        return nil
    }
}

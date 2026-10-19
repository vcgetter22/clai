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

/// The menu bar item: the tally and, by default, today's spend.
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
    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = CommandLine.arguments
        let model = AppModel.shared
        if let index = arguments.firstIndex(of: "--render"), index + 1 < arguments.count {
            ExportRenderer.render(model: model, to: URL(fileURLWithPath: arguments[index + 1], isDirectory: true))
            NSApp.terminate(nil)
            return
        }
        if arguments.contains("--window") {
            PreviewWindow.show(model: model)
        }
        if !model.isDemo && !Self.isOnlyInstance() {
            NSApp.terminate(nil)
            return
        }
        model.start()
        if arguments.contains("--open-panel") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { StatusItemOpener.open() }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        AppModel.shared.shutdown()
    }

    /// A second launch hands over to the running copy instead of adding a second menu bar item.
    private static func isOnlyInstance() -> Bool {
        guard let id = Bundle.main.bundleIdentifier else { return true }
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: id).filter { $0 != NSRunningApplication.current }
        guard let other = others.first else { return true }
        other.activate()
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
            let view = PanelView()
                .environment(model)
                .environment(\.exportRendering, true)
                .environment(\.colorScheme, scheme)
                .background(scheme == .dark ? Color(hex: 0x1C1F1E) : Color(hex: 0xF4F6F4))
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
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

/// `--window` shows the panel in an ordinary window, so it can be captured with real materials.
@MainActor
enum PreviewWindow {
    private static var window: NSWindow?

    static func show(model: AppModel) {
        let hosting = NSHostingView(rootView: PanelView().environment(model))
        let size = hosting.fittingSize
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: Metrics.panelWidth, height: max(400, size.height)),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
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
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        print("CLAI_WINDOW_ID=\(window.windowNumber)")
        fflush(stdout)
        self.window = window
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

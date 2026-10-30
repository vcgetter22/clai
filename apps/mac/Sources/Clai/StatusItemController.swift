import AppKit
import ClaiCore
import SwiftUI

/// The menu bar item: the tally and a figure; a click opens the panel, a right click a small menu.
@MainActor
final class StatusItemController: NSObject, NSPopoverDelegate {
    private let item: NSStatusItem
    private let popover = NSPopover()
    private let state: AppState
    private let openWindow: () -> Void
    private var shownTitle: String?? = .none
    private var monitors: [Any] = []
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []

    init(state: AppState, openWindow: @escaping () -> Void) {
        self.state = state
        self.openWindow = openWindow
        // A stable name before the item gets its size, so macOS remembers its place and visibility.
        item = NSStatusBar.system.statusItem(withLength: 0)
        super.init()
        item.autosaveName = "clai.main"
        item.length = NSStatusItem.variableLength
        if let button = item.button {
            button.image = MenuBarIcon.tally
            button.imagePosition = .imageOnly
            button.font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
            button.target = self
            button.action = #selector(clicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.setAccessibilityLabel("clai")
        }
        popover.behavior = .applicationDefined
        popover.animates = true
        popover.delegate = self
        state.menuBarTitleChanged = { [weak self] title in
            MainActor.assumeIsolated { self?.show(title: title) }
        }
        show(title: state.menuBarTitle)
    }

    /// Whether the item is on screen. It can be hidden behind the camera notch when the menu bar is
    /// full (macOS still calls it visible then), or not allowed in the menu bar (System Settings,
    /// macOS 26).
    var looksVisible: Bool {
        guard item.isVisible, let window = item.button?.window, window.frame.width > 0,
              let screen = NSScreen.screens.first(where: { $0.frame.intersects(window.frame) }) else { return false }
        // The camera housing is the gap between the two unobscured areas at the top of the screen.
        if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            let notchMinX = screen.frame.minX + left.width
            let notchMaxX = screen.frame.maxX - right.width
            if notchMaxX > notchMinX, window.frame.maxX > notchMinX, window.frame.minX < notchMaxX { return false }
        }
        return true
    }

    func remove() {
        NSStatusBar.system.removeStatusItem(item)
    }

    /// Writes to the menu bar only when the figure changes (macOS 26 does not like a stream of
    /// identical updates).
    private func show(title: String?) {
        if case .some(let shown) = shownTitle, shown == title { return }
        shownTitle = .some(title)
        guard let button = item.button else { return }
        if let title, !title.isEmpty {
            button.title = title
            button.imagePosition = .imageLeading
            button.setAccessibilityLabel("clai, \(title)")
        } else {
            button.title = ""
            button.imagePosition = .imageOnly
            button.setAccessibilityLabel("clai")
        }
    }

    // MARK: Clicks

    @objc private func clicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            showMenu()
        } else if popover.isShown {
            closePopover()
        } else {
            showPopover()
        }
    }

    private func showMenu() {
        closePopover()
        let menu = NSMenu()
        menu.addItem(withTitle: "Refresh", action: #selector(refresh), keyEquivalent: "r").target = self
        menu.addItem(withTitle: "Open clai Window", action: #selector(openWindowAction), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit clai", action: #selector(quit), keyEquivalent: "q").target = self
        item.menu = menu
        item.button?.performClick(nil)
        item.menu = nil
    }

    @objc private func refresh() { state.refresh() }
    @objc private func openWindowAction() { openWindow() }
    @objc private func quit() { NSApp.terminate(nil) }

    // MARK: Panel

    func showPopover() {
        guard let button = item.button else { return }
        state.page = .overview
        // The SwiftUI panel exists only while it is open, so a closed panel costs nothing.
        let hosting = NSHostingController(rootView: PanelView(state: state, context: .popover))
        hosting.sizingOptions = .preferredContentSize
        popover.contentViewController = hosting
        state.panelOpened()
        Activation.bringForward()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        watchForDismissal()
    }

    func closePopover() {
        if popover.isShown { popover.performClose(nil) }
    }

    func popoverDidClose(_ notification: Notification) {
        stopWatchingForDismissal()
        popover.contentViewController = nil
    }

    private func stopWatchingForDismissal() {
        monitors.forEach { NSEvent.removeMonitor($0) }
        monitors = []
        observers.forEach { center, token in center.removeObserver(token) }
        observers = []
    }

    /// The panel closes on a click elsewhere, on Escape, when another app becomes active (⌘Tab) and
    /// when the Space changes. (A `.transient` popover closes on the first mouse move in a
    /// full-screen Space.)
    private func watchForDismissal() {
        stopWatchingForDismissal()
        for (center, name) in [(NotificationCenter.default, NSApplication.didResignActiveNotification),
                               (NSWorkspace.shared.notificationCenter, NSWorkspace.activeSpaceDidChangeNotification)] {
            let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.closePopover() }
            }
            observers.append((center, token))
        }
        if let outside = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown], handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.closePopover() }
        }) {
            monitors.append(outside)
        }
        if let escape = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { [weak self] event in
            guard event.keyCode == 53 else { return event }
            MainActor.assumeIsolated { self?.closePopover() }
            return nil
        }) {
            monitors.append(escape)
        }
    }
}

enum Activation {
    static func bringForward() {
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }
}

/// The panel in an ordinary window: on the first launch, when clai is opened again, and from the
/// menu. While it is open clai has a Dock icon and the app menu (Quit, ⌘Q); closing it leaves the
/// menu bar item alone.
@MainActor
final class PanelWindowController: NSObject, NSWindowDelegate {
    private var window: NSWindow?

    func show(state: AppState, welcome: Bool) {
        if let window {
            window.makeKeyAndOrderFront(nil)
            Activation.bringForward()
            return
        }
        let hosting = NSHostingController(rootView: PanelView(state: state, context: .window(welcome: welcome)))
        hosting.sizingOptions = .preferredContentSize
        let window = NSWindow(contentViewController: hosting)
        window.styleMask = [.titled, .closable, .miniaturizable, .fullSizeContentView]
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.title = "clai"
        window.delegate = self
        window.center()
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        Activation.bringForward()
        self.window = window
        // The panel sizes itself in its first layout passes; center the window once it has.
        DispatchQueue.main.async { [weak window] in
            MainActor.assumeIsolated { window?.center() }
        }
    }

    /// The window follows the panel's height; keep all of it on screen.
    func windowDidResize(_ notification: Notification) {
        guard let window, let screen = window.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        var frame = window.frame
        if frame.maxY > visible.maxY { frame.origin.y = visible.maxY - frame.height }
        if frame.minY < visible.minY { frame.origin.y = min(visible.minY, visible.maxY - frame.height) }
        if frame.origin != window.frame.origin { window.setFrameOrigin(frame.origin) }
    }

    func windowWillClose(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                self?.window = nil
                NSApp.setActivationPolicy(.accessory)
            }
        }
    }
}

enum MenuBarIcon {
    /// The clai tally (four strokes and a diagonal) as a template image, so it follows the menu bar.
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

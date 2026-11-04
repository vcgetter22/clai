import AppKit
import ClaiCore

// The program starts on the main thread; everything below runs there.
MainActor.assumeIsolated {
    // `clai --status-line`: Claude Code's status line command once connected in Settings. Saves
    // Claude's plan limits, runs the user's own status line command and quits, before any AppKit.
    if CommandLine.arguments.contains(ClaudeStatusLine.flag) {
        let input = FileHandle.standardInput.readDataToEndOfFile()
        exit(StatusLineRunner.run(input: input, limitsURL: AppState.claudeLimitsFile, installedURL: AppState.statusLineFile,
                                  historyURL: AppState.claudeLimitsHistoryFile))
    }

    // `clai --report`: read the logs, print what clai counts, and quit (no window, no menu bar item).
    if CommandLine.arguments.contains("--report") {
        let prices = AppState.storedPrices()
        let scanner = UsageScanner(home: AppState.home, ledgerURL: AppState.supportFolder.appendingPathComponent("ledger.json"),
                                   cloudURL: AppState.cloudFile, limitsHistoryURL: AppState.claudeLimitsHistoryFile)
        let result = scanner.refresh(pricer: Pricer(list: prices))
        print(Report.text(result, version: AppVersion.current, prices: prices, claudeLimits: ClaudeLimits.load(from: AppState.claudeLimitsFile)),
              terminator: "")
        exit(0)
    }

    // clai is a menu bar app: no Dock icon (LSUIElement) except while its window is open.
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    withExtendedLifetime(delegate) { app.run() }
}

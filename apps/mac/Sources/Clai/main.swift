import AppKit
import ClaiCore

// `clai --report`: read the logs, print what clai counts, and quit (no window, no menu bar item).
if CommandLine.arguments.contains("--report") {
    let prices = AppState.storedPrices()
    let scanner = UsageScanner(home: AppState.home, ledgerURL: AppState.supportFolder.appendingPathComponent("ledger.json"))
    let result = scanner.refresh(pricer: Pricer(list: prices))
    print(Report.text(result, version: AppVersion.current, prices: prices), terminator: "")
    exit(0)
}

// clai is a menu bar app: no Dock icon (LSUIElement) except while its window is open.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

import Foundation

/// `clai --report`: what clai reads and counts, as plain text. For checking an installation and for
/// bug reports; it prints the same numbers as the panel and nothing from inside the logs.
public enum Report {
    public static func text(_ result: ScanResult, version: String, prices: PriceList) -> String {
        let s = result.summary
        var out: [String] = []
        out.append("clai \(version) · prices of \(prices.version) · read in \(String(format: "%.2f", result.duration)) s")
        out.append("")
        if s.isEmpty {
            out.append("No usage found.")
        } else {
            out.append("\(Format.monthName(s.today)) so far: \(Format.usd(s.monthCost)) API-equivalent · today \(Format.usd(s.todayCost)) · last month \(Format.usd(s.lastMonthCost))")
            out.append("\(Format.count(s.monthRequests)) requests, \(Format.tokens(s.monthTokens)) tokens this month; last usage \(s.lastUsageDay?.description ?? "none")")
            out.append("")
            out.append("Tools this month")
            for t in s.tools {
                out.append("  " + pad(t.tool.name, 16) + pad(Format.usd(t.cost), 12, right: true) + pad(Format.tokens(t.tokens), 9, right: true) + " tokens" + pad(Format.count(t.requests), 10, right: true) + " requests")
            }
            out.append("")
            out.append("Models this month")
            for m in s.models {
                var note = ""
                switch m.basis {
                case .listed: break
                case .estimated(let like): note = "  (priced like \(like))"
                case .logged: note = "  (cost as logged by the tool)"
                case .unpriced: note = "  (no price)"
                }
                out.append("  " + pad(m.name, 28) + pad(Format.usd(m.cost), 12, right: true) + pad(Format.tokens(m.tokens), 9, right: true) + " tokens" + note)
            }
        }
        out.append("")
        out.append("Sources")
        for source in result.sources {
            let state = source.found ? "\(Format.count(source.files)) files, \(Format.count(source.requests)) requests" : "not found"
            out.append("  " + pad(source.tool.name, 16) + pad(state, 34) + source.folders.joined(separator: ", "))
        }
        if let limits = result.codexLimits {
            out.append("")
            let windows = [limits.primary, limits.secondary].compactMap { $0 }.map { "\(Int($0.usedPercent.rounded()))% of \($0.windowMinutes.map { "\($0) min" } ?? "?")" }
            out.append("Codex limits: " + windows.joined(separator: ", ") + (limits.planType.map { " (\($0))" } ?? ""))
        }
        return out.joined(separator: "\n") + "\n"
    }

    private static func pad(_ text: String, _ width: Int, right: Bool = false) -> String {
        guard text.count < width else { return text + " " }
        let space = String(repeating: " ", count: width - text.count)
        return right ? space + text : text + space
    }
}

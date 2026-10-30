import XCTest
@testable import ClaiCore

final class ReleaseTests: XCTestCase {
    func testVersions() {
        XCTAssertEqual(SemanticVersion("mac-v1.2.3")?.description, "1.2.3")
        XCTAssertEqual(SemanticVersion("v1.2")?.description, "1.2.0")
        XCTAssertEqual(SemanticVersion("1.0.0-dev")?.description, "1.0.0")
        XCTAssertNil(SemanticVersion("latest"))
        XCTAssertNil(SemanticVersion("1..2"))
        XCTAssertTrue(SemanticVersion("1.10.0")! > SemanticVersion("1.9.9")!)
    }

    func testLatestRelease() {
        let json = #"{"tag_name":"mac-v1.1.0","html_url":"https://github.com/vcgetter22/clai/releases/tag/mac-v1.1.0","draft":false,"prerelease":false}"#
        let release = LatestRelease.parse(Data(json.utf8))
        XCTAssertEqual(release?.version.description, "1.1.0")
        XCTAssertEqual(release?.isNewer(than: "1.0.0"), true)
        XCTAssertEqual(release?.isNewer(than: "1.1.0"), false)
        XCTAssertNil(LatestRelease.parse(Data(#"{"tag_name":"v9.0.0","html_url":"https://x"}"#.utf8)))
        XCTAssertNil(LatestRelease.parse(Data(#"{"tag_name":"mac-v9.0.0","html_url":"https://x","prerelease":true}"#.utf8)))
        XCTAssertNil(LatestRelease.parse(Data("oops".utf8)))
    }
}

final class FormatTests: XCTestCase {
    func testMoney() {
        XCTAssertEqual(Format.usd(0), "$0")
        XCTAssertEqual(Format.usd(0.0042), "$0.0042")
        XCTAssertEqual(Format.usd(0.042), "$0.042")
        XCTAssertEqual(Format.usd(12.345), "$12.35")
        XCTAssertEqual(Format.usd(1082.4), "$1,082")
        XCTAssertEqual(Format.usd(12_500, compact: true), "$13k")
        XCTAssertEqual(Format.usd(1_250, compact: true), "$1.3k")
        XCTAssertEqual(Format.usdShort(4.2), "$4.20")
        XCTAssertEqual(Format.usdShort(42.4), "$42")
        XCTAssertEqual(Format.usdShort(1_082.4), "$1,082")
        XCTAssertEqual(Format.usdShort(23_400), "$23k")
        XCTAssertEqual(Format.usdShort(0.001), "$0")
        XCTAssertEqual(Format.usd(.nan), "–")
    }

    func testTokensAndMultiples() {
        XCTAssertEqual(Format.tokens(950), "950")
        XCTAssertEqual(Format.tokens(12_300), "12.3k")
        XCTAssertEqual(Format.tokens(4_500_000), "4.5M")
        XCTAssertEqual(Format.tokens(1_200_000_000), "1.20B")
        XCTAssertEqual(Format.multiple(8.42), "8.4×")
        XCTAssertEqual(Format.multiple(123.4), "123×")
        XCTAssertEqual(Format.count(1_234_567), "1,234,567")
    }

    func testDates() {
        let now = Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!)
        let en = Locale(identifier: "en_US_POSIX")
        XCTAssertEqual(Format.relative(now.addingTimeInterval(-20), now: now), "just now")
        XCTAssertEqual(Format.relative(now.addingTimeInterval(-600), now: now), "10 min ago")
        XCTAssertEqual(Format.relative(now.addingTimeInterval(-7200), now: now), "2 h ago")
        XCTAssertEqual(Format.shortDay(Day(year: 2026, month: 10, day: 4)), "Oct 4")
        XCTAssertEqual(Format.monthName(Day(year: 2026, month: 10, day: 4)), "October")
        XCTAssertFalse(Format.resetTime(now.addingTimeInterval(3600), now: now, locale: en, timeZone: utc).isEmpty)
        XCTAssertEqual(Format.resetTime(now.addingTimeInterval(10 * 86_400), now: now, locale: en, timeZone: utc), "Nov 9")
    }
}

final class ReportTests: XCTestCase {
    func testReportNamesTheNumbersAndTheSources() {
        let home = TempHome()
        home.write(".claude/projects/p/s.jsonl", lines([Fixture.claude(id: "msg_1", model: "claude-opus-9-9")]))
        let result = UsageScanner(home: home.path, ledgerURL: nil)
            .refresh(pricer: Pricer(list: .builtIn), now: Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!), timeZone: utc)
        let text = Report.text(result, version: "1.0.0", prices: .builtIn)
        XCTAssertTrue(text.contains("October so far: $"), text)
        XCTAssertTrue(text.contains("Claude Code"), text)
        XCTAssertTrue(text.contains("priced like Claude Opus 5.5"), text)
        XCTAssertTrue(text.contains("Gemini CLI"), text)
        XCTAssertTrue(text.contains("not found"), text)
        XCTAssertFalse(text.contains("…"), "no log content in the report")
    }
}

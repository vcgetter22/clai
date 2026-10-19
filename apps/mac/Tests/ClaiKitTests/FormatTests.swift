import XCTest
@testable import ClaiKit

/// Same conventions as `formatUsd` / `formatTokens` in packages/core/src/time.ts.
final class FormatTests: XCTestCase {
    func testUsdMatchesTheCore() {
        XCTAssertEqual(Format.usd(nil), "-")
        XCTAssertEqual(Format.usd(0), "$0")
        XCTAssertEqual(Format.usd(0.0042), "$0.0042")
        XCTAssertEqual(Format.usd(0.042), "$0.042")
        XCTAssertEqual(Format.usd(12.347), "$12.35")
        XCTAssertEqual(Format.usd(99.999), "$100.00")
        XCTAssertEqual(Format.usd(134.8091), "$135")
        XCTAssertEqual(Format.usd(1234.5), "$1,235")
        XCTAssertEqual(Format.usd(3864.54), "$3,865")
        XCTAssertEqual(Format.usd(1_234_567), "$1,234,567")
        XCTAssertEqual(Format.usd(1500, compact: true), "$1.5k")
        XCTAssertEqual(Format.usd(12_400, compact: true), "$12k")
        XCTAssertEqual(Format.usd(950, compact: true), "$950")
    }

    func testShortUsdForTheMenuBar() {
        XCTAssertEqual(Format.usdShort(4.2), "$4.20")
        XCTAssertEqual(Format.usdShort(67.76), "$68")
        XCTAssertEqual(Format.usdShort(1081.86), "$1,082")
        XCTAssertEqual(Format.usdShort(12_400), "$12k")
    }

    func testTokens() {
        XCTAssertEqual(Format.tokens(950), "950")
        XCTAssertEqual(Format.tokens(12_345), "12.3k")
        XCTAssertEqual(Format.tokens(123_456), "123k")
        XCTAssertEqual(Format.tokens(4_500_000), "4.5M")
        XCTAssertEqual(Format.tokens(123_000_000), "123M")
        XCTAssertEqual(Format.tokens(1_200_000_000), "1.20B")
    }

    func testPercentagesAndMultiples() {
        XCTAssertEqual(Format.percent(0.256), "26%")
        XCTAssertEqual(Format.percent(0.256, digits: 1), "25.6%")
        XCTAssertEqual(Format.signedPercent(0.25), "+25%")
        XCTAssertEqual(Format.signedPercent(-0.08), "\u{2212}8%")
        XCTAssertEqual(Format.signedPercent(0.001), "±0%")
        XCTAssertEqual(Format.multiple(38.65), "38.6×")
        XCTAssertEqual(Format.multiple(12.32), "12.3×")
    }

    func testRelativeTime() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(Format.relative(now.addingTimeInterval(-10), now: now), "just now")
        XCTAssertEqual(Format.relative(now.addingTimeInterval(-70), now: now), "1 min ago")
        XCTAssertEqual(Format.relative(now.addingTimeInterval(-12 * 60), now: now), "12 min ago")
        XCTAssertEqual(Format.relative(now.addingTimeInterval(-3 * 3600), now: now), "3 h ago")
        XCTAssertEqual(Format.relative(now.addingTimeInterval(-2 * 86400), now: now), "2 d ago")
        XCTAssertEqual(Format.relative(now.addingTimeInterval(30), now: now), "just now")
    }

    func testCalendarLabels() {
        XCTAssertEqual(Format.monthName("2026-10"), "October")
        XCTAssertEqual(Format.monthName("2026-13"), "2026-13")
        XCTAssertEqual(Format.dayLabel("2026-10-14"), "Oct 14")
        XCTAssertEqual(Format.dayLabel("nonsense"), "nonsense")
        XCTAssertEqual(Format.dayDate("2026-10-14")?.timeIntervalSince1970, 1_791_979_200) // noon UTC
        XCTAssertNil(Format.dayDate("2026-10"))
    }

    func testGroupingAndRounding() {
        XCTAssertEqual(Format.grouped(0), "0")
        XCTAssertEqual(Format.grouped(999), "999")
        XCTAssertEqual(Format.grouped(1000), "1,000")
        XCTAssertEqual(Format.grouped(-1234), "-1,234")
        XCTAssertEqual(Format.jsRound(2.5), 3)
        XCTAssertEqual(Format.jsRound(-2.5), -2)
        XCTAssertEqual(Format.fixed(-0.001, 2), "0.00")
    }
}

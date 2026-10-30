import XCTest
@testable import ClaiCore

final class TimeTests: XCTestCase {
    func testParsesToolTimestamps() {
        XCTAssertEqual(Timestamp.parse("1970-01-01T00:00:00Z"), 0)
        XCTAssertEqual(Timestamp.parse("2026-10-30T12:34:56.789Z")!, 1_793_363_696.789, accuracy: 0.0001)
        XCTAssertEqual(Timestamp.parse("2026-10-30T14:34:56.789+02:00")!, 1_793_363_696.789, accuracy: 0.0001)
        XCTAssertEqual(Timestamp.parse("2026-10-30T12:34:56"), 1_793_363_696)
        XCTAssertNil(Timestamp.parse("yesterday"))
        XCTAssertNil(Timestamp.parse("2026-13-30T12:34:56Z"))
    }

    func testMatchesFoundation() {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        for text in ["2024-02-29T23:59:59.500Z", "2000-01-01T00:00:00.000Z", "2031-07-04T08:15:00.250Z"] {
            XCTAssertEqual(Timestamp.parse(text)!, formatter.date(from: text)!.timeIntervalSince1970, accuracy: 0.001, text)
        }
    }

    func testDaysInTimeZones() {
        let t = Timestamp.parse("2026-10-30T23:30:00Z")!
        var utc = DayResolver(timeZone: TimeZone(identifier: "UTC")!)
        var berlin = DayResolver(timeZone: TimeZone(identifier: "Europe/Berlin")!)
        var la = DayResolver(timeZone: TimeZone(identifier: "America/Los_Angeles")!)
        var kathmandu = DayResolver(timeZone: TimeZone(identifier: "Asia/Kathmandu")!)
        XCTAssertEqual(utc.day(at: t), Day(year: 2026, month: 10, day: 30))
        XCTAssertEqual(berlin.day(at: t), Day(year: 2026, month: 10, day: 31))
        XCTAssertEqual(la.day(at: t), Day(year: 2026, month: 10, day: 30))
        // UTC+5:45: 18:14 UTC is 23:59 there, 18:15 UTC is the next day.
        XCTAssertEqual(kathmandu.day(at: Timestamp.parse("2026-10-30T18:14:00Z")!), Day(year: 2026, month: 10, day: 30))
        XCTAssertEqual(kathmandu.day(at: Timestamp.parse("2026-10-30T18:15:00Z")!), Day(year: 2026, month: 10, day: 31))
    }

    func testDayArithmetic() {
        let d = Day(year: 2026, month: 3, day: 1)
        XCTAssertEqual(d.adding(days: -1), Day(year: 2026, month: 2, day: 28))
        XCTAssertEqual(Day(year: 2024, month: 3, day: 1).adding(days: -1), Day(year: 2024, month: 2, day: 29))
        XCTAssertEqual(Day(year: 2026, month: 1, day: 15).previousMonthStart, Day(year: 2025, month: 12, day: 1))
        XCTAssertEqual(Day(ordinal: 0), Day(year: 1970, month: 1, day: 1))
        XCTAssertEqual(d.description, "2026-03-01")
    }
}

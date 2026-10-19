// swift-tools-version: 5.10
import PackageDescription

// clai for Mac. ClaiKit is Foundation only (snapshot model, formatting, engine runner) so its
// tests also run on Linux; the Clai app target needs SwiftUI and AppKit and builds on macOS only.
var targets: [Target] = [
    .target(name: "ClaiKit"),
    .testTarget(name: "ClaiKitTests", dependencies: ["ClaiKit"], exclude: ["Fixtures"]),
]
var products: [Product] = [.library(name: "ClaiKit", targets: ["ClaiKit"])]

#if os(macOS)
targets.append(.executableTarget(name: "Clai", dependencies: ["ClaiKit"]))
products.append(.executable(name: "Clai", targets: ["Clai"]))
#endif

let package = Package(
    name: "Clai",
    platforms: [.macOS(.v14)],
    products: products,
    targets: targets
)

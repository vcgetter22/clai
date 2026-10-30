// swift-tools-version: 5.9
import PackageDescription

// clai for Mac.
// ClaiCore is Foundation only (log readers, prices, the ledger), so its tests also run on Linux.
// The Clai app target needs AppKit and SwiftUI and builds on macOS only.
var targets: [Target] = [
    .target(name: "ClaiCore"),
    .testTarget(name: "ClaiCoreTests", dependencies: ["ClaiCore"]),
]

#if os(macOS)
targets.append(.executableTarget(name: "Clai", dependencies: ["ClaiCore"]))
#endif

let package = Package(
    name: "Clai",
    platforms: [.macOS(.v13)],
    targets: targets
)

// swift-tools-version:5.9
// SwiftPM only reads a manifest at the repository root, so this one points at
// swift/. Tag Swift releases as plain X.Y.Z (other SDKs use <sdk>/vX.Y.Z tags,
// which SwiftPM ignores). swift/Package.swift is the same package for local work.
import PackageDescription

let package = Package(
    name: "IForevents",
    platforms: [.iOS(.v13), .macOS(.v10_15), .tvOS(.v13), .watchOS(.v6)],
    products: [
        .library(name: "IForevents", targets: ["IForevents"]),
    ],
    targets: [
        .target(name: "IForevents", path: "swift/Sources/IForevents"),
    ],
    swiftLanguageVersions: [.v5]
)

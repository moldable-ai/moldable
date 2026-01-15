// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "moldable-audio-capture",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .executableTarget(
            name: "moldable-audio-capture",
            path: "Sources"
        )
    ]
)

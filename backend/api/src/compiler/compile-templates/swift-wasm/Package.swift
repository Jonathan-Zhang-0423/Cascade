// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SwiftUIWebApp",
    platforms: [.macOS(.v10_15)],
    dependencies: [
        .package(url: "https://github.com/nicklama/JavaScriptKit.git", exact: "0.21.0"),
    ],
    targets: [
        .target(
            name: "SwiftUIWeb",
            dependencies: [
                .product(name: "JavaScriptKit", package: "JavaScriptKit"),
            ],
            path: "Sources/SwiftUIWeb"
        ),
        .executableTarget(
            name: "App",
            dependencies: [
                "SwiftUIWeb",
                .product(name: "JavaScriptKit", package: "JavaScriptKit"),
            ],
            path: "Sources/App"
        ),
    ]
)

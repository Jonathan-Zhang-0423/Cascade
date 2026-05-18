import JavaScriptKit

public protocol SwiftUIApp {
    associatedtype Content: View
    @ViewBuilder var body: Content { get }
    init()
}

public class SwiftUIWebApp {
    static var shared: SwiftUIWebApp?
    let rootView: AnyView
    var rerenderScheduled = false

    public init<A: SwiftUIApp>(_ appType: A.Type) {
        let app = A()
        self.rootView = AnyView(app.body)
        SwiftUIWebApp.shared = self
    }

    public func run() {
        render()
    }

    func render() {
        let root = document.getElementById("swift-ui-root")
        _ = root.object?.innerHTML = .string("")

        _ = root.style.setProperty("font-family", "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif")
        _ = root.style.setProperty("-webkit-font-smoothing", "antialiased")
        _ = root.style.setProperty("height", "100%")
        _ = root.style.setProperty("display", "flex")
        _ = root.style.setProperty("flex-direction", "column")

        rootView.renderFn(root)
    }

    public func scheduleRerender() {
        guard !rerenderScheduled else { return }
        rerenderScheduled = true
        _ = JSObject.global.requestAnimationFrame!(JSClosure { [weak self] _ in
            self?.rerenderScheduled = false
            self?.render()
            return .undefined
        })
    }
}

public func runApp<A: SwiftUIApp>(_ appType: A.Type) {
    let app = SwiftUIWebApp(appType)
    app.run()
}

import JavaScriptKit

public protocol View {
    associatedtype Body: View
    @ViewBuilder var body: Body { get }
}

extension Never: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct AnyView: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let renderFn: (JSValue) -> Void

    public init<V: View>(_ view: V) {
        if let anyV = view as? AnyView {
            self.renderFn = anyV.renderFn
        } else if let modified = view as? AnyModifiedView {
            self.renderFn = { parent in
                modified.renderWithModifier(into: parent)
            }
        } else {
            self.renderFn = { parent in
                renderView(view, into: parent)
            }
        }
    }
}

public protocol AnyModifiedView {
    func renderWithModifier(into parent: JSValue)
}

extension ModifiedView: AnyModifiedView {
    public func renderWithModifier(into parent: JSValue) {
        if isBoxModelModifier(modifier) {
            let wrapper = createElement("div")
            applyModifier(modifier, to: wrapper)
            renderView(content, into: wrapper)
            _ = parent.appendChild(wrapper)
        } else {
            let wrapper = createElement("div")
            _ = wrapper.style.setProperty("display", "contents")
            applyModifier(modifier, to: wrapper)
            renderView(content, into: wrapper)
            _ = parent.appendChild(wrapper)
        }
    }
}

public struct Text: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let content: String

    public init(_ content: String) {
        self.content = content
    }
}

public struct Button: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let label: AnyView
    let action: () -> Void

    public init(action: @escaping () -> Void, @ViewBuilder label: () -> some View) {
        self.action = action
        self.label = AnyView(label())
    }

    public init(_ title: String, action: @escaping () -> Void) {
        self.action = action
        self.label = AnyView(Text(title))
    }
}

public struct Image: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let systemName: String?
    let name: String?

    public init(systemName: String) {
        self.systemName = systemName
        self.name = nil
    }

    public init(_ name: String) {
        self.name = name
        self.systemName = nil
    }
}

public struct Spacer: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let minLength: Double?

    public init(minLength: Double? = nil) {
        self.minLength = minLength
    }
}

public struct Divider: View {
    public typealias Body = Never
    public var body: Never { fatalError() }

    public init() {}
}

public struct EmptyView: View {
    public typealias Body = Never
    public var body: Never { fatalError() }

    public init() {}
}

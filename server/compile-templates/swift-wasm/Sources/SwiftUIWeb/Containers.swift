import JavaScriptKit

public struct VStack: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let alignment: HorizontalAlignment
    let spacing: Double?
    let children: [AnyView]

    public init(alignment: HorizontalAlignment = .center, spacing: Double? = nil, @ViewBuilder content: () -> some View) {
        self.alignment = alignment
        self.spacing = spacing
        let built = content()
        self.children = collectChildren(built)
    }
}

public struct HStack: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let alignment: VerticalAlignment
    let spacing: Double?
    let children: [AnyView]

    public init(alignment: VerticalAlignment = .center, spacing: Double? = nil, @ViewBuilder content: () -> some View) {
        self.alignment = alignment
        self.spacing = spacing
        let built = content()
        self.children = collectChildren(built)
    }
}

public struct ZStack: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let alignment: Alignment
    let children: [AnyView]

    public init(alignment: Alignment = .center, @ViewBuilder content: () -> some View) {
        self.alignment = alignment
        let built = content()
        self.children = collectChildren(built)
    }
}

public struct ScrollView: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let axes: Axis
    let children: [AnyView]

    public init(_ axes: Axis = .vertical, @ViewBuilder content: () -> some View) {
        self.axes = axes
        let built = content()
        self.children = collectChildren(built)
    }
}

public struct List: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let children: [AnyView]

    public init(@ViewBuilder content: () -> some View) {
        let built = content()
        self.children = collectChildren(built)
    }
}

public struct NavigationStack: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let children: [AnyView]

    public init(@ViewBuilder content: () -> some View) {
        let built = content()
        self.children = collectChildren(built)
    }
}

public struct ForEach<Data: RandomAccessCollection, Content: View>: View where Data.Element: Identifiable {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let data: Data
    let contentBuilder: (Data.Element) -> Content

    public init(_ data: Data, @ViewBuilder content: @escaping (Data.Element) -> Content) {
        self.data = data
        self.contentBuilder = content
    }
}

public struct Group: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let children: [AnyView]

    public init(@ViewBuilder content: () -> some View) {
        let built = content()
        self.children = collectChildren(built)
    }
}

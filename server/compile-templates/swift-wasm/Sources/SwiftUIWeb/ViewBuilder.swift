@resultBuilder
public struct ViewBuilder {
    public static func buildBlock() -> EmptyView {
        EmptyView()
    }

    public static func buildBlock<C: View>(_ content: C) -> C {
        content
    }

    public static func buildBlock<C0: View, C1: View>(_ c0: C0, _ c1: C1) -> TupleView2<C0, C1> {
        TupleView2(c0, c1)
    }

    public static func buildBlock<C0: View, C1: View, C2: View>(_ c0: C0, _ c1: C1, _ c2: C2) -> TupleView3<C0, C1, C2> {
        TupleView3(c0, c1, c2)
    }

    public static func buildBlock<C0: View, C1: View, C2: View, C3: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3) -> TupleView4<C0, C1, C2, C3> {
        TupleView4(c0, c1, c2, c3)
    }

    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4) -> TupleView5<C0, C1, C2, C3, C4> {
        TupleView5(c0, c1, c2, c3, c4)
    }

    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5) -> TupleView6<C0, C1, C2, C3, C4, C5> {
        TupleView6(c0, c1, c2, c3, c4, c5)
    }

    public static func buildOptional<C: View>(_ component: C?) -> ConditionalView<C> {
        ConditionalView(component)
    }

    public static func buildEither<TrueContent: View, FalseContent: View>(first component: TrueContent) -> EitherView<TrueContent, FalseContent> {
        .first(component)
    }

    public static func buildEither<TrueContent: View, FalseContent: View>(second component: FalseContent) -> EitherView<TrueContent, FalseContent> {
        .second(component)
    }
}

public struct TupleView2<C0: View, C1: View>: View, AnyFlattenable {
    public typealias Body = Never
    public var body: Never { fatalError() }
    public let v0: C0
    public let v1: C1
    public init(_ v0: C0, _ v1: C1) { self.v0 = v0; self.v1 = v1 }

    public func flattenedViews() -> [AnyView] {
        return flattenToAnyViews(v0) + flattenToAnyViews(v1)
    }
}

public struct TupleView3<C0: View, C1: View, C2: View>: View, AnyFlattenable {
    public typealias Body = Never
    public var body: Never { fatalError() }
    public let v0: C0
    public let v1: C1
    public let v2: C2
    public init(_ v0: C0, _ v1: C1, _ v2: C2) { self.v0 = v0; self.v1 = v1; self.v2 = v2 }

    public func flattenedViews() -> [AnyView] {
        return flattenToAnyViews(v0) + flattenToAnyViews(v1) + flattenToAnyViews(v2)
    }
}

public struct TupleView4<C0: View, C1: View, C2: View, C3: View>: View, AnyFlattenable {
    public typealias Body = Never
    public var body: Never { fatalError() }
    public let v0: C0
    public let v1: C1
    public let v2: C2
    public let v3: C3
    public init(_ v0: C0, _ v1: C1, _ v2: C2, _ v3: C3) { self.v0 = v0; self.v1 = v1; self.v2 = v2; self.v3 = v3 }

    public func flattenedViews() -> [AnyView] {
        return flattenToAnyViews(v0) + flattenToAnyViews(v1) + flattenToAnyViews(v2) + flattenToAnyViews(v3)
    }
}

public struct TupleView5<C0: View, C1: View, C2: View, C3: View, C4: View>: View, AnyFlattenable {
    public typealias Body = Never
    public var body: Never { fatalError() }
    public let v0: C0
    public let v1: C1
    public let v2: C2
    public let v3: C3
    public let v4: C4
    public init(_ v0: C0, _ v1: C1, _ v2: C2, _ v3: C3, _ v4: C4) { self.v0 = v0; self.v1 = v1; self.v2 = v2; self.v3 = v3; self.v4 = v4 }

    public func flattenedViews() -> [AnyView] {
        return flattenToAnyViews(v0) + flattenToAnyViews(v1) + flattenToAnyViews(v2) + flattenToAnyViews(v3) + flattenToAnyViews(v4)
    }
}

public struct TupleView6<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View>: View, AnyFlattenable {
    public typealias Body = Never
    public var body: Never { fatalError() }
    public let v0: C0
    public let v1: C1
    public let v2: C2
    public let v3: C3
    public let v4: C4
    public let v5: C5
    public init(_ v0: C0, _ v1: C1, _ v2: C2, _ v3: C3, _ v4: C4, _ v5: C5) { self.v0 = v0; self.v1 = v1; self.v2 = v2; self.v3 = v3; self.v4 = v4; self.v5 = v5 }

    public func flattenedViews() -> [AnyView] {
        return flattenToAnyViews(v0) + flattenToAnyViews(v1) + flattenToAnyViews(v2) + flattenToAnyViews(v3) + flattenToAnyViews(v4) + flattenToAnyViews(v5)
    }
}

public protocol AnyFlattenable {
    func flattenedViews() -> [AnyView]
}

public struct ConditionalView<C: View>: View, AnyFlattenable {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let content: C?
    public init(_ content: C?) { self.content = content }

    public func flattenedViews() -> [AnyView] {
        if let c = content {
            return flattenToAnyViews(c)
        }
        return []
    }
}

public enum EitherView<First: View, Second: View>: View, AnyFlattenable {
    public typealias Body = Never
    public var body: Never { fatalError() }
    case first(First)
    case second(Second)

    public func flattenedViews() -> [AnyView] {
        switch self {
        case .first(let view): return flattenToAnyViews(view)
        case .second(let view): return flattenToAnyViews(view)
        }
    }
}

public func flattenToAnyViews<V: View>(_ view: V) -> [AnyView] {
    if let flattenable = view as? AnyFlattenable {
        return flattenable.flattenedViews()
    }
    if view is EmptyView {
        return []
    }
    return [AnyView(view)]
}

func collectChildren<V: View>(_ view: V) -> [AnyView] {
    return flattenToAnyViews(view)
}

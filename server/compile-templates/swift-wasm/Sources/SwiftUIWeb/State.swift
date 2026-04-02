import JavaScriptKit

public final class StateStorage<Value> {
    var value: Value
    init(_ value: Value) {
        self.value = value
    }
}

@propertyWrapper
public struct State<Value> {
    private let storage: StateStorage<Value>

    public init(wrappedValue: Value) {
        self.storage = StateStorage(wrappedValue)
    }

    public var wrappedValue: Value {
        get { storage.value }
        nonmutating set {
            storage.value = newValue
            SwiftUIWebApp.shared?.scheduleRerender()
        }
    }

    public var projectedValue: Binding<Value> {
        Binding(
            get: { [storage] in storage.value },
            set: { [storage] newValue in
                storage.value = newValue
                SwiftUIWebApp.shared?.scheduleRerender()
            }
        )
    }
}

@propertyWrapper
public struct Binding<Value> {
    let getter: () -> Value
    let setter: (Value) -> Void

    public init(get: @escaping () -> Value, set: @escaping (Value) -> Void) {
        self.getter = get
        self.setter = set
    }

    public var wrappedValue: Value {
        get { getter() }
        nonmutating set { setter(newValue) }
    }

    public var projectedValue: Binding<Value> { self }
}

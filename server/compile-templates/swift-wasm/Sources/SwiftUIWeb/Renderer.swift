import JavaScriptKit

let document = JSObject.global.document

func createElement(_ tag: String) -> JSValue {
    return document.createElement(tag)
}

func isBoxModelModifier(_ modifier: Modifier) -> Bool {
    switch modifier {
    case .padding, .background, .frame, .cornerRadius, .border, .opacity, .shadow:
        return true
    default:
        return false
    }
}

func applyModifier(_ modifier: Modifier, to element: JSValue) {
    switch modifier {
    case .padding(let insets):
        _ = element.style.setProperty("padding-top", "\(insets.top)px")
        _ = element.style.setProperty("padding-right", "\(insets.trailing)px")
        _ = element.style.setProperty("padding-bottom", "\(insets.bottom)px")
        _ = element.style.setProperty("padding-left", "\(insets.leading)px")
    case .foregroundColor(let color):
        _ = element.style.setProperty("color", color.cssValue)
    case .background(let color):
        _ = element.style.setProperty("background-color", color.cssValue)
    case .font(let font):
        _ = element.style.setProperty("font-size", font.cssSize)
        _ = element.style.setProperty("font-weight", font.cssWeight)
    case .fontWeight(let weight):
        _ = element.style.setProperty("font-weight", weight.cssValue)
    case .frame(let width, let height, let minWidth, let maxWidth, let minHeight, let maxHeight, _):
        if let w = width { _ = element.style.setProperty("width", "\(w)px") }
        if let h = height { _ = element.style.setProperty("height", "\(h)px") }
        if let mnw = minWidth { _ = element.style.setProperty("min-width", "\(mnw)px") }
        if let mnh = minHeight { _ = element.style.setProperty("min-height", "\(mnh)px") }
        if let mw = maxWidth {
            if mw >= 1e9 {
                _ = element.style.setProperty("width", "100%")
            } else {
                _ = element.style.setProperty("max-width", "\(mw)px")
            }
        }
        if let mh = maxHeight {
            if mh >= 1e9 {
                _ = element.style.setProperty("height", "100%")
            } else {
                _ = element.style.setProperty("max-height", "\(mh)px")
            }
        }
    case .cornerRadius(let r):
        _ = element.style.setProperty("border-radius", "\(r)px")
        _ = element.style.setProperty("overflow", "hidden")
    case .border(let color, let width):
        _ = element.style.setProperty("border", "\(width)px solid \(color.cssValue)")
    case .opacity(let value):
        _ = element.style.setProperty("opacity", "\(value)")
    case .shadow(let color, let radius, let x, let y):
        _ = element.style.setProperty("box-shadow", "\(x)px \(y)px \(radius)px \(color.cssValue)")
    case .navigationTitle(let title):
        _ = JSObject.global.document.object?.title = .string(title)
    case .bold:
        _ = element.style.setProperty("font-weight", "700")
    case .italic:
        _ = element.style.setProperty("font-style", "italic")
    case .lineLimit(let limit):
        if let l = limit {
            _ = element.style.setProperty("overflow", "hidden")
            _ = element.style.setProperty("display", "-webkit-box")
            _ = element.style.setProperty("-webkit-line-clamp", "\(l)")
            _ = element.style.setProperty("-webkit-box-orient", "vertical")
        }
    case .multilineTextAlignment(let alignment):
        switch alignment {
        case .leading: _ = element.style.setProperty("text-align", "left")
        case .center: _ = element.style.setProperty("text-align", "center")
        case .trailing: _ = element.style.setProperty("text-align", "right")
        }
    }
}

func renderTupleChildren(_ children: [AnyView], into parent: JSValue) {
    for child in children {
        child.renderFn(parent)
    }
}

private var renderDepth = 0
private let maxRenderDepth = 50

public func renderView<V: View>(_ view: V, into parent: JSValue) {
    if let anyModified = view as? AnyModifiedView {
        anyModified.renderWithModifier(into: parent)
        return
    }

    if let text = view as? Text {
        let span = createElement("span")
        _ = span.object?.textContent = .string(text.content)
        _ = span.style.setProperty("font-family", "-apple-system, BlinkMacSystemFont, 'SF Pro', 'Helvetica Neue', sans-serif")
        _ = parent.appendChild(span)
    } else if let vstack = view as? VStack {
        let div = createElement("div")
        _ = div.style.setProperty("display", "flex")
        _ = div.style.setProperty("flex-direction", "column")
        if let spacing = vstack.spacing {
            _ = div.style.setProperty("gap", "\(spacing)px")
        } else {
            _ = div.style.setProperty("gap", "8px")
        }
        switch vstack.alignment {
        case .leading: _ = div.style.setProperty("align-items", "flex-start")
        case .trailing: _ = div.style.setProperty("align-items", "flex-end")
        case .center: _ = div.style.setProperty("align-items", "center")
        }
        renderTupleChildren(vstack.children, into: div)
        _ = parent.appendChild(div)
    } else if let hstack = view as? HStack {
        let div = createElement("div")
        _ = div.style.setProperty("display", "flex")
        _ = div.style.setProperty("flex-direction", "row")
        if let spacing = hstack.spacing {
            _ = div.style.setProperty("gap", "\(spacing)px")
        } else {
            _ = div.style.setProperty("gap", "8px")
        }
        switch hstack.alignment {
        case .top: _ = div.style.setProperty("align-items", "flex-start")
        case .bottom: _ = div.style.setProperty("align-items", "flex-end")
        case .center: _ = div.style.setProperty("align-items", "center")
        }
        renderTupleChildren(hstack.children, into: div)
        _ = parent.appendChild(div)
    } else if let zstack = view as? ZStack {
        let div = createElement("div")
        _ = div.style.setProperty("position", "relative")
        for child in zstack.children {
            let wrapper = createElement("div")
            _ = wrapper.style.setProperty("position", "absolute")
            _ = wrapper.style.setProperty("top", "0")
            _ = wrapper.style.setProperty("left", "0")
            _ = wrapper.style.setProperty("width", "100%")
            _ = wrapper.style.setProperty("height", "100%")
            child.renderFn(wrapper)
            _ = div.appendChild(wrapper)
        }
        _ = parent.appendChild(div)
    } else if let button = view as? Button {
        let btn = createElement("button")
        _ = btn.style.setProperty("font-family", "-apple-system, BlinkMacSystemFont, 'SF Pro', 'Helvetica Neue', sans-serif")
        _ = btn.style.setProperty("background-color", "#007AFF")
        _ = btn.style.setProperty("color", "#FFFFFF")
        _ = btn.style.setProperty("border", "none")
        _ = btn.style.setProperty("border-radius", "8px")
        _ = btn.style.setProperty("padding", "10px 20px")
        _ = btn.style.setProperty("font-size", "17px")
        _ = btn.style.setProperty("cursor", "pointer")
        button.label.renderFn(btn)
        let closure = JSClosure { _ in
            button.action()
            return .undefined
        }
        _ = btn.addEventListener("click", closure)
        _ = parent.appendChild(btn)
    } else if let spacer = view as? Spacer {
        let div = createElement("div")
        _ = div.style.setProperty("flex", "1")
        if let minLen = spacer.minLength {
            _ = div.style.setProperty("min-width", "\(minLen)px")
            _ = div.style.setProperty("min-height", "\(minLen)px")
        }
        _ = parent.appendChild(div)
    } else if view is Divider {
        let hr = createElement("hr")
        _ = hr.style.setProperty("border", "none")
        _ = hr.style.setProperty("border-top", "1px solid #C6C6C8")
        _ = hr.style.setProperty("margin", "0")
        _ = hr.style.setProperty("width", "100%")
        _ = parent.appendChild(hr)
    } else if let image = view as? Image {
        if let name = image.name {
            let img = createElement("img")
            _ = img.object?.src = .string(name)
            _ = img.style.setProperty("max-width", "100%")
            _ = parent.appendChild(img)
        } else {
            let span = createElement("span")
            _ = span.style.setProperty("font-size", "24px")
            let symbolMap: [String: String] = [
                "star": "\u{2605}", "star.fill": "\u{2605}",
                "heart": "\u{2661}", "heart.fill": "\u{2665}",
                "checkmark": "\u{2713}", "xmark": "\u{2715}",
                "plus": "+", "minus": "\u{2212}",
                "arrow.right": "\u{2192}", "arrow.left": "\u{2190}",
                "arrow.up": "\u{2191}", "arrow.down": "\u{2193}",
                "gear": "\u{2699}", "person": "\u{1F464}", "house": "\u{1F3E0}",
                "magnifyingglass": "\u{1F50D}", "bell": "\u{1F514}",
                "envelope": "\u{2709}", "phone": "\u{1F4DE}",
                "trash": "\u{1F5D1}", "pencil": "\u{270F}",
                "folder": "\u{1F4C1}", "doc": "\u{1F4C4}",
                "photo": "\u{1F5BC}", "camera": "\u{1F4F7}",
                "mic": "\u{1F3A4}", "play": "\u{25B6}",
                "pause": "\u{23F8}", "stop": "\u{23F9}",
            ]
            let symbol = symbolMap[image.systemName ?? ""] ?? "\u{25C6}"
            _ = span.object?.textContent = .string(symbol)
            _ = parent.appendChild(span)
        }
    } else if let list = view as? List {
        let div = createElement("div")
        _ = div.style.setProperty("display", "flex")
        _ = div.style.setProperty("flex-direction", "column")
        _ = div.style.setProperty("width", "100%")
        for (i, child) in list.children.enumerated() {
            let row = createElement("div")
            _ = row.style.setProperty("padding", "12px 16px")
            _ = row.style.setProperty("background-color", "#FFFFFF")
            if i < list.children.count - 1 {
                _ = row.style.setProperty("border-bottom", "1px solid #E5E5EA")
            }
            child.renderFn(row)
            _ = div.appendChild(row)
        }
        _ = parent.appendChild(div)
    } else if let navStack = view as? NavigationStack {
        let container = createElement("div")
        _ = container.style.setProperty("display", "flex")
        _ = container.style.setProperty("flex-direction", "column")
        _ = container.style.setProperty("height", "100%")
        renderTupleChildren(navStack.children, into: container)
        _ = parent.appendChild(container)
    } else if let scrollView = view as? ScrollView {
        let div = createElement("div")
        _ = div.style.setProperty("overflow", "auto")
        _ = div.style.setProperty("display", "flex")
        switch scrollView.axes {
        case .vertical: _ = div.style.setProperty("flex-direction", "column")
        case .horizontal: _ = div.style.setProperty("flex-direction", "row")
        }
        renderTupleChildren(scrollView.children, into: div)
        _ = parent.appendChild(div)
    } else if let group = view as? Group {
        renderTupleChildren(group.children, into: parent)
    } else if let anyView = view as? AnyView {
        anyView.renderFn(parent)
    } else if view is EmptyView {
    } else if let flattenable = view as? AnyFlattenable {
        let children = flattenable.flattenedViews()
        renderTupleChildren(children, into: parent)
    } else {
        renderDepth += 1
        if renderDepth < maxRenderDepth {
            renderView(view.body, into: parent)
        }
        renderDepth -= 1
    }
}

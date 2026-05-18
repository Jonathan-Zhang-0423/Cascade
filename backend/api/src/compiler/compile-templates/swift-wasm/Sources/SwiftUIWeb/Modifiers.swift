import JavaScriptKit

public enum Modifier {
    case padding(EdgeInsets)
    case foregroundColor(Color)
    case background(Color)
    case font(Font)
    case fontWeight(FontWeight)
    case frame(width: Double?, height: Double?, minWidth: Double?, maxWidth: Double?, minHeight: Double?, maxHeight: Double?, alignment: Alignment)
    case cornerRadius(Double)
    case border(Color, width: Double)
    case opacity(Double)
    case shadow(color: Color, radius: Double, x: Double, y: Double)
    case navigationTitle(String)
    case bold
    case italic
    case lineLimit(Int?)
    case multilineTextAlignment(TextAlignment)
}

public struct EdgeInsets {
    public let top: Double
    public let leading: Double
    public let bottom: Double
    public let trailing: Double

    public init(top: Double = 0, leading: Double = 0, bottom: Double = 0, trailing: Double = 0) {
        self.top = top
        self.leading = leading
        self.bottom = bottom
        self.trailing = trailing
    }

    public static func all(_ value: Double) -> EdgeInsets {
        EdgeInsets(top: value, leading: value, bottom: value, trailing: value)
    }
}

public enum TextAlignment {
    case leading, center, trailing
}

public enum HorizontalAlignment {
    case leading, center, trailing
}

public enum VerticalAlignment {
    case top, center, bottom
}

public struct Alignment {
    public static let center = Alignment()
    public static let leading = Alignment()
    public static let trailing = Alignment()
    public static let top = Alignment()
    public static let bottom = Alignment()
    public static let topLeading = Alignment()
    public static let topTrailing = Alignment()
    public static let bottomLeading = Alignment()
    public static let bottomTrailing = Alignment()
}

public enum Axis {
    case horizontal, vertical
}

public struct Color {
    public let cssValue: String

    public static let black = Color(cssValue: "#000000")
    public static let white = Color(cssValue: "#FFFFFF")
    public static let red = Color(cssValue: "#FF3B30")
    public static let orange = Color(cssValue: "#FF9500")
    public static let yellow = Color(cssValue: "#FFCC00")
    public static let green = Color(cssValue: "#34C759")
    public static let mint = Color(cssValue: "#00C7BE")
    public static let teal = Color(cssValue: "#30B0C7")
    public static let cyan = Color(cssValue: "#32ADE6")
    public static let blue = Color(cssValue: "#007AFF")
    public static let indigo = Color(cssValue: "#5856D6")
    public static let purple = Color(cssValue: "#AF52DE")
    public static let pink = Color(cssValue: "#FF2D55")
    public static let brown = Color(cssValue: "#A2845E")
    public static let gray = Color(cssValue: "#8E8E93")
    public static let primary = Color(cssValue: "#007AFF")
    public static let secondary = Color(cssValue: "#8E8E93")
    public static let clear = Color(cssValue: "transparent")
    public static let accentColor = Color(cssValue: "#007AFF")

    public init(red: Double, green: Double, blue: Double, opacity: Double = 1.0) {
        let r = Int(red * 255)
        let g = Int(green * 255)
        let b = Int(blue * 255)
        self.cssValue = "rgba(\(r), \(g), \(b), \(opacity))"
    }
}

public struct Font {
    public let cssSize: String
    public let cssWeight: String

    public static let largeTitle = Font(cssSize: "34px", cssWeight: "700")
    public static let title = Font(cssSize: "28px", cssWeight: "700")
    public static let title2 = Font(cssSize: "22px", cssWeight: "700")
    public static let title3 = Font(cssSize: "20px", cssWeight: "600")
    public static let headline = Font(cssSize: "17px", cssWeight: "600")
    public static let subheadline = Font(cssSize: "15px", cssWeight: "400")
    public static let body = Font(cssSize: "17px", cssWeight: "400")
    public static let callout = Font(cssSize: "16px", cssWeight: "400")
    public static let footnote = Font(cssSize: "13px", cssWeight: "400")
    public static let caption = Font(cssSize: "12px", cssWeight: "400")
    public static let caption2 = Font(cssSize: "11px", cssWeight: "400")

    public static func system(size: Double, weight: FontWeight = .regular) -> Font {
        Font(cssSize: "\(size)px", cssWeight: weight.cssValue)
    }
}

public enum FontWeight {
    case ultraLight, thin, light, regular, medium, semibold, bold, heavy, black

    var cssValue: String {
        switch self {
        case .ultraLight: return "100"
        case .thin: return "200"
        case .light: return "300"
        case .regular: return "400"
        case .medium: return "500"
        case .semibold: return "600"
        case .bold: return "700"
        case .heavy: return "800"
        case .black: return "900"
        }
    }
}

public let infinity: Double = 1e10

extension View {
    public func padding(_ value: Double = 16) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .padding(.all(value)))
    }

    public func padding(_ edges: Edge.Set, _ value: Double) -> ModifiedView<Self> {
        var insets = EdgeInsets()
        if edges.contains(.top) { insets = EdgeInsets(top: value, leading: insets.leading, bottom: insets.bottom, trailing: insets.trailing) }
        if edges.contains(.bottom) { insets = EdgeInsets(top: insets.top, leading: insets.leading, bottom: value, trailing: insets.trailing) }
        if edges.contains(.leading) { insets = EdgeInsets(top: insets.top, leading: value, bottom: insets.bottom, trailing: insets.trailing) }
        if edges.contains(.trailing) { insets = EdgeInsets(top: insets.top, leading: insets.leading, bottom: insets.bottom, trailing: value) }
        return ModifiedView(content: self, modifier: .padding(insets))
    }

    public func foregroundColor(_ color: Color) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .foregroundColor(color))
    }

    public func foregroundStyle(_ color: Color) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .foregroundColor(color))
    }

    public func background(_ color: Color) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .background(color))
    }

    public func font(_ font: Font) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .font(font))
    }

    public func fontWeight(_ weight: FontWeight) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .fontWeight(weight))
    }

    public func frame(width: Double? = nil, height: Double? = nil, alignment: Alignment = .center) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .frame(width: width, height: height, minWidth: nil, maxWidth: nil, minHeight: nil, maxHeight: nil, alignment: alignment))
    }

    public func frame(minWidth: Double? = nil, maxWidth: Double? = nil, minHeight: Double? = nil, maxHeight: Double? = nil, alignment: Alignment = .center) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .frame(width: nil, height: nil, minWidth: minWidth, maxWidth: maxWidth, minHeight: minHeight, maxHeight: maxHeight, alignment: alignment))
    }

    public func cornerRadius(_ radius: Double) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .cornerRadius(radius))
    }

    public func border(_ color: Color, width: Double = 1) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .border(color, width: width))
    }

    public func opacity(_ value: Double) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .opacity(value))
    }

    public func shadow(color: Color = .gray, radius: Double, x: Double = 0, y: Double = 0) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .shadow(color: color, radius: radius, x: x, y: y))
    }

    public func navigationTitle(_ title: String) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .navigationTitle(title))
    }

    public func bold() -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .bold)
    }

    public func italic() -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .italic)
    }

    public func lineLimit(_ limit: Int?) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .lineLimit(limit))
    }

    public func multilineTextAlignment(_ alignment: TextAlignment) -> ModifiedView<Self> {
        ModifiedView(content: self, modifier: .multilineTextAlignment(alignment))
    }
}

public struct ModifiedView<Content: View>: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
    let content: Content
    let modifier: Modifier
}

public struct Edge {
    public struct Set: OptionSet {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }

        public static let top = Set(rawValue: 1 << 0)
        public static let bottom = Set(rawValue: 1 << 1)
        public static let leading = Set(rawValue: 1 << 2)
        public static let trailing = Set(rawValue: 1 << 3)
        public static let horizontal: Set = [.leading, .trailing]
        public static let vertical: Set = [.top, .bottom]
        public static let all: Set = [.top, .bottom, .leading, .trailing]
    }
}

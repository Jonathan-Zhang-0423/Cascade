import SwiftUIWeb

struct ContentView: View {
    var body: some View {
        VStack(spacing: 20) {
            Text("Hello, SwiftUI!")
                .font(.title)
                .foregroundColor(.blue)
            Text("Preview loading...")
                .font(.body)
                .foregroundColor(.gray)
        }
        .padding()
    }
}

struct MyApp: SwiftUIApp {
    var body: some View {
        ContentView()
    }
}

runApp(MyApp.self)

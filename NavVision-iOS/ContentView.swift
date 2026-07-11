import SwiftUI

struct ContentView: View {
    var body: some View {
        // Embeds the local web app using WebKit and ignores safe areas to mimic native fullscreen
        WebView()
            .edgesIgnoringSafeArea(.all)
            .statusBar(hidden: true)
    }
}

#Preview {
    ContentView()
}

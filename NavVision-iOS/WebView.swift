import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    
    func makeUIView(context: Context) -> WKWebView {
        // Configure WebView to allow media playback (TTS/Sonar) without full screen limits
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = [] // Allow autoplay for TTS and Sonar
        
        let webView = WKWebView(frame: .zero, configuration: config)
        
        // Hide scroll indicators and bounce to feel like a native app
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .black
        
        return webView
    }
    
    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Load the local index.html from WebAssets folder
        if let indexPath = Bundle.main.path(forResource: "index", ofType: "html", inDirectory: "WebAssets") {
            let fileURL = URL(fileURLWithPath: indexPath)
            let directoryURL = fileURL.deletingLastPathComponent()
            uiView.loadFileURL(fileURL, allowingReadAccessTo: directoryURL)
        } else {
            print("Error: Could not find index.html in WebAssets folder.")
        }
    }
}

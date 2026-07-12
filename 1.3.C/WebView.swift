import SwiftUI
import WebKit

/// Same WKWebView setup as before (inline media playback, no scroll/bounce),
/// plus the native bridge needed for LiDAR: a WKScriptMessageHandler to
/// receive the "toggleScanner" command from the "Start Camera" button, and
/// a genuinely transparent background so the ARSCNView passthrough behind
/// this view shows through wherever the page's CSS leaves a transparent gap
/// (currently just .camera-radar-container in style.css).
struct WebView: UIViewRepresentable {
    var onToggleScanner: () -> Void = {}
    var onCoordinatorReady: (Coordinator) -> Void = { _ in }

    func makeCoordinator() -> Coordinator {
        Coordinator(onToggleScanner: onToggleScanner)
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        // "nativeBridge" must match window.webkit.messageHandlers.nativeBridge
        // in app.js's sendNativeCommand().
        contentController.add(context.coordinator, name: "nativeBridge")

        // Configure WebView to allow media playback (TTS/Sonar) without full screen limits
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = [] // Allow autoplay for TTS and Sonar
        config.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator

        // Hide scroll indicators and bounce to feel like a native app
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false

        // Genuinely transparent (not black) so the native ARSCNView camera
        // passthrough behind this view shows through .camera-radar-container.
        // Every other element keeps its own opaque CSS background
        // (--bg-primary etc.), so the rest of the design is unaffected.
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear

        context.coordinator.webView = webView
        onCoordinatorReady(context.coordinator)

        // Load the local index.html from WebAssets folder
        if let indexPath = Bundle.main.path(forResource: "index", ofType: "html", inDirectory: "WebAssets") {
            let fileURL = URL(fileURLWithPath: indexPath)
            let directoryURL = fileURL.deletingLastPathComponent()
            webView.loadFileURL(fileURL, allowingReadAccessTo: directoryURL)
        } else {
            print("Error: Could not find index.html in WebAssets folder.")
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // No-op: pushes into the page happen explicitly via the coordinator
        // (see ContentView), not via SwiftUI diffing.
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        weak var webView: WKWebView?
        let onToggleScanner: () -> Void
        private var pageIsReady = false
        private var pendingCalls: [String] = []

        init(onToggleScanner: @escaping () -> Void) {
            self.onToggleScanner = onToggleScanner
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let command = body["command"] as? String else { return }

            switch command {
            case "toggleScanner":
                onToggleScanner()
            default:
                print("Unknown command from web view: \(command)")
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            pageIsReady = true
            pendingCalls.forEach { evaluate($0, on: webView) }
            pendingCalls.removeAll()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("Web view navigation failed: \(error.localizedDescription)")
        }

        /// Pushes a JS call into the page, queuing it if the page hasn't
        /// finished loading yet rather than silently dropping it.
        func call(_ script: String) {
            guard let webView = webView else { return }
            if pageIsReady {
                evaluate(script, on: webView)
            } else {
                pendingCalls.append(script)
            }
        }

        private func evaluate(_ script: String, on webView: WKWebView) {
            webView.evaluateJavaScript(script) { _, error in
                if let error = error {
                    print("JS bridge call failed: \(error.localizedDescription)\nScript: \(script)")
                }
            }
        }
    }
}

import SwiftUI
import WebKit

/// Hosts the NavVision web app in a transparent WKWebView, and bridges it
/// to native ARKit/LiDAR:
///   JS -> Swift: "toggleScanner" command (from the Start/Stop Camera button)
///   Swift -> JS: window.nativeUpdateDistance(meters|null),
///                window.nativeUpdateTrackingState(stateString),
///                window.nativeScannerStateChanged(isRunning)
struct NavVisionWebView: UIViewRepresentable {
    @ObservedObject var depthMonitor: LidarDepthMonitor
    var onToggleScanner: () -> Void
    var onCoordinatorReady: (Coordinator) -> Void = { _ in }

    func makeCoordinator() -> Coordinator {
        Coordinator(onToggleScanner: onToggleScanner)
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "nativeBridge")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        // Transparent so .camera-radar-container's transparent CSS
        // background reveals the native ARPassthroughView behind it. Every
        // other element keeps its own opaque CSS background (--bg-primary
        // etc.), so the rest of the design renders exactly as built.
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false // this is an app UI, not a scrolling page

        context.coordinator.webView = webView
        onCoordinatorReady(context.coordinator)

        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "WebApp") {
            let webAppDirectory = indexURL.deletingLastPathComponent()
            webView.loadFileURL(indexURL, allowingReadAccessTo: webAppDirectory)
        } else {
            assertionFailure("Could not find WebApp/index.html in bundle. Check the WebApp folder was added as a folder reference (blue icon), not a group.")
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // No-op: pushes to the page happen explicitly via the coordinator,
        // driven by the parent view's onReceive/Combine subscriptions
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

        // MARK: - Pushing calls into the page

        func call(_ script: String) {
            guard let webView = webView else { return }
            if pageIsReady {
                evaluate(script, on: webView)
            } else {
                // Queue calls made before the page finishes loading (e.g. an
                // early distance reading right at launch) rather than
                // silently dropping them.
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

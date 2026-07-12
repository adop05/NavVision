import SwiftUI
import ARKit

struct ContentView: View {
    @StateObject private var depthMonitor: LidarDepthMonitor
    @StateObject private var alertController: ProximityAlertController
    @State private var bridge: WebView.Coordinator?

    init() {
        let monitor = LidarDepthMonitor()
        _depthMonitor = StateObject(wrappedValue: monitor)
        _alertController = StateObject(wrappedValue: ProximityAlertController(depthMonitor: monitor))
    }

    var body: some View {
        ZStack {
            // Native camera passthrough — sits behind the transparent
            // WebView. Only visible where the page's CSS leaves a
            // transparent gap (.camera-radar-container in style.css).
            ARPassthroughView(session: depthMonitor.session)
                .ignoresSafeArea()

            WebView(
                onToggleScanner: {
                    depthMonitor.toggle()
                    // Ack back to JS with the real resulting state, rather
                    // than assuming the toggle succeeded.
                    bridge?.call("window.nativeScannerStateChanged(\(depthMonitor.isRunning));")
                },
                onSetSonarMuted: { muted in
                    alertController.setMuted(muted)
                },
                onCoordinatorReady: { coordinator in
                    DispatchQueue.main.async {
                        bridge = coordinator
                    }
                }
            )
            .edgesIgnoringSafeArea(.all)
        }
        .statusBar(hidden: true)
        .onReceive(depthMonitor.$nearestDistance) { distance in
            let valueLiteral = distance.map { String($0) } ?? "null"
            bridge?.call("window.nativeUpdateDistance(\(valueLiteral));")
        }
        .onReceive(depthMonitor.$trackingState) { trackingState in
            bridge?.call("window.nativeUpdateTrackingState('\(trackingState.bridgeDescription)');")
        }
    }
}

#Preview {
    ContentView()
}

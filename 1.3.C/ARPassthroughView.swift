import SwiftUI
import ARKit
import SceneKit

/// Full-screen passthrough view showing the ARSession's live camera feed,
/// with no AR content added. Sits behind the transparent WKWebView; wherever
/// the web page's CSS leaves a background transparent (currently just
/// .camera-radar-container), this shows through at that exact screen
/// position — no manual coordinate syncing needed, since both views share
/// the same full-screen frame.
struct ARPassthroughView: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.session = session
        view.automaticallyUpdatesLighting = false
        view.antialiasingMode = .none
        view.scene = SCNScene()
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {}
}

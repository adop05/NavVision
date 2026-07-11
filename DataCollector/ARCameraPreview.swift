import SwiftUI
import ARKit
import SceneKit

/// Shows the live ARSession camera passthrough as a full-screen preview.
/// No AR content is added — this purely displays the camera feed so you can
/// frame the chest-mounted shot before/while recording.
struct ARCameraPreview: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.session = session
        view.automaticallyUpdatesLighting = false
        view.antialiasingMode = .none
        // No scene content; ARSCNView renders the camera background by default.
        view.scene = SCNScene()
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        // No dynamic updates needed; session drives frames directly.
    }
}

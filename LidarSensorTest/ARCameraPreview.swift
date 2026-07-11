import SwiftUI
import ARKit
import SceneKit

/// Shows the live ARSession camera passthrough. Not strictly required for
/// a beep-only proximity sensor (a blind user won't be looking at the
/// screen), but useful during development/testing to visually confirm
/// what the depth sampler is seeing, and for sighted helpers/family
/// assisting with setup.
struct ARCameraPreview: UIViewRepresentable {
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

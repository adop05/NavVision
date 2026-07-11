import SwiftUI
import ARKit

struct ContentView: View {
    @StateObject private var recorder = ARFrameRecorder()
    @State private var showingRecordingsList = false

    var body: some View {
        ZStack {
            ARCameraPreview(session: recorder.session)
                .ignoresSafeArea()

            VStack {
                topBar
                Spacer()
                bottomControls
            }
        }
        .onAppear { recorder.startSession() }
        .onDisappear { recorder.pauseSession() }
        .sheet(isPresented: $showingRecordingsList) {
            RecordingsListView()
        }
    }

    private var topBar: some View {
        HStack {
            trackingStatusLabel
            Spacer()
            Button {
                showingRecordingsList = true
            } label: {
                Image(systemName: "list.bullet")
                    .font(.title2)
                    .foregroundColor(.white)
                    .padding(12)
                    .background(.black.opacity(0.5))
                    .clipShape(Circle())
            }
        }
        .padding()
    }

    private var trackingStatusLabel: some View {
        Text(trackingStatusText)
            .font(.caption)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.black.opacity(0.5))
            .foregroundColor(.white)
            .clipShape(Capsule())
    }

    private var trackingStatusText: String {
        switch recorder.trackingState {
        case .normal:
            return "Tracking OK"
        case .notAvailable:
            return "Initializing…"
        case .limited(let reason):
            switch reason {
            case .excessiveMotion: return "Limited: too much motion"
            case .insufficientFeatures: return "Limited: low texture/light"
            case .initializing: return "Initializing…"
            case .relocalizing: return "Relocalizing…"
            @unknown default: return "Limited tracking"
            }
        }
    }

    private var bottomControls: some View {
        VStack(spacing: 16) {
            if recorder.isRecording {
                Text(formattedElapsed)
                    .font(.system(.title2, design: .monospaced))
                    .foregroundColor(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(.black.opacity(0.5))
                    .clipShape(Capsule())
            }

            Button {
                if recorder.isRecording {
                    recorder.stopRecording()
                } else {
                    recorder.startRecording()
                }
            } label: {
                ZStack {
                    Circle()
                        .stroke(.white, lineWidth: 4)
                        .frame(width: 76, height: 76)

                    if recorder.isRecording {
                        RoundedRectangle(cornerRadius: 6)
                            .fill(.red)
                            .frame(width: 30, height: 30)
                    } else {
                        Circle()
                            .fill(.red)
                            .frame(width: 62, height: 62)
                    }
                }
            }
        }
        .padding(.bottom, 40)
    }

    private var formattedElapsed: String {
        let total = Int(recorder.elapsedSeconds)
        let minutes = total / 60
        let seconds = total % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

#Preview {
    ContentView()
}

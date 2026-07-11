import SwiftUI
import UIKit

struct RecordingsListView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var recordings: [URL] = []
    @State private var shareURL: URL?

    var body: some View {
        NavigationView {
            List {
                if recordings.isEmpty {
                    Text("No recordings yet.")
                        .foregroundColor(.secondary)
                }
                ForEach(recordings, id: \.self) { url in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(url.lastPathComponent)
                                .font(.subheadline)
                            if let size = fileSizeString(for: url) {
                                Text(size)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                        Spacer()
                        Button {
                            shareURL = url
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                }
                .onDelete(perform: deleteRecordings)
            }
            .navigationTitle("Recordings")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    EditButton()
                }
            }
            .onAppear(perform: loadRecordings)
            .sheet(item: Binding(
                get: { shareURL.map { IdentifiableURL(url: $0) } },
                set: { shareURL = $0?.url }
            )) { identifiableURL in
                ShareSheet(activityItems: [identifiableURL.url])
            }
        }
    }

    private func loadRecordings() {
        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: documentsURL, includingPropertiesForKeys: [.contentModificationDateKey]
        ) else {
            recordings = []
            return
        }

        recordings = files
            .filter { $0.pathExtension.lowercased() == "mp4" }
            .sorted { lhs, rhs in
                let lhsDate = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
                let rhsDate = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
                return lhsDate > rhsDate
            }
    }

    private func deleteRecordings(at offsets: IndexSet) {
        for index in offsets {
            try? FileManager.default.removeItem(at: recordings[index])
        }
        loadRecordings()
    }

    private func fileSizeString(for url: URL) -> String? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attributes[.size] as? Int64 else { return nil }
        return ByteCountFormatter.string(fromByteCount: size, countStyle: .file)
    }
}

private struct IdentifiableURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// Wraps UIActivityViewController so recorded clips can be AirDropped,
/// saved to Files, or pulled into whatever annotation tool you're using
/// (e.g. exporting to a machine running CVAT).
private struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

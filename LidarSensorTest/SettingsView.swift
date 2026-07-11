import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: SettingsStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            Form {
                Section {
                    Stepper(
                        value: $settings.alertStartDistance,
                        in: settings.alertStartDistanceRange,
                        step: 0.1
                    ) {
                        VStack(alignment: .leading) {
                            Text("Alert Start Distance")
                            Text(String(format: "%.1f m — beeping starts within this range", settings.alertStartDistance))
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                } header: {
                    Text("Minimum Distance to Start Alerting")
                } footer: {
                    Text("Increase this if you want warnings earlier (more time to react); decrease it if beeping feels like it's triggering too often on things that aren't actually in your path.")
                }

                Section {
                    Stepper(
                        value: $settings.criticalDistance,
                        in: settings.criticalDistanceRange,
                        step: 0.05
                    ) {
                        VStack(alignment: .leading) {
                            Text("Critical Distance")
                            Text(String(format: "%.2f m — beeping reaches max speed here", settings.criticalDistance))
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                } header: {
                    Text("Maximum Urgency Threshold")
                } footer: {
                    Text("At or below this distance, beeping is as fast as it gets. Must stay smaller than the alert start distance.")
                }

                Section {
                    HStack {
                        Text("Slowest beep interval")
                        Spacer()
                        Text(String(format: "%.2fs", settings.slowestBeepInterval))
                            .foregroundColor(.secondary)
                    }
                    Slider(value: $settings.slowestBeepInterval, in: 0.4...2.0, step: 0.05)

                    HStack {
                        Text("Fastest beep interval")
                        Spacer()
                        Text(String(format: "%.2fs", settings.fastestBeepInterval))
                            .foregroundColor(.secondary)
                    }
                    Slider(value: $settings.fastestBeepInterval, in: 0.05...0.5, step: 0.01)
                } header: {
                    Text("Beep Rate Range")
                } footer: {
                    Text("Controls how slow/fast the beeping gets at the far and near ends of the alert range.")
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    SettingsView(settings: SettingsStore())
}

import SwiftUI
import Combine
import VisionKit
import LocalAuthentication

// MARK: - Settings

struct SettingsSheet: View {
    @Environment(Linker.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var scanning = false
    @State private var syncMode = false

    var body: some View {
        NavigationStack {
            List {
                AssistantModelSection()

                Section {
                    if link.pairings.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Use Monolith on your computer").font(.sub)
                            Text("Open Monolith in a browser, choose **Your phone**, and scan the code. Everything stays in sync, from any network.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 6)
                    }
                    ForEach(link.pairings) { p in ComputerRow(pairing: p) }
                        .onDelete { $0.map { link.pairings[$0] }.forEach(link.unlink) }
                    Button { scanning = true } label: { Label("Link a computer", systemImage: "laptopcomputer") }
                } header: {
                    Text("Linked computers").sectionTitle()
                } footer: {
                    Text("Encrypted end to end. The relay that connects your devices can’t read your notes.")
                }

                if !link.pairings.isEmpty {
                    Section {
                        Button { syncMode = true } label: { Label("Sync mode", systemImage: "moon") }
                    } footer: {
                        Text("Keeps Monolith open with the screen dimmed and locked, so your computers stay in sync overnight. Plug in to charge.")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .paper()
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $scanning) { ScanSheet() }
            .fullScreenCover(isPresented: $syncMode) { SyncModeView() }
        }
    }
}

/// Pick how capable the assistant is. Downloading and loading happen on their own.
private struct AssistantModelSection: View {
    @AppStorage("assistantModel") private var choice = "default"
    private var models: OpenModels { .shared }
    private var selected: OpenModel? { Assistant.openModel(for: choice) }

    var body: some View {
        Section {
            if OpenModels.supported {
                Picker("Model", selection: $choice) {
                    if OpenModels.fits(OpenModels.model(for: .fast)) { tierRow("Fast", .fast).tag("fast") }
                    if OpenModels.fits(OpenModels.recommended) { tierRow("Default", .default).tag("default") }
                    if OpenModels.fits(OpenModels.model(for: .enhanced)) { tierRow("Enhanced", .enhanced).tag("enhanced") }
                    if Assistant.appleAvailable {
                        row("Apple Intelligence", "Built in, nothing to download").tag("apple")
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
                let more = OpenModels.catalog.filter { $0.tier == .more && OpenModels.fits($0) }
                if !more.isEmpty {
                    DisclosureGroup("More models") {
                        Picker("More models", selection: $choice) {
                            ForEach(more) { m in row(m.name, m.note).tag(m.id) }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                }
            } else {
                Text(Assistant.appleAvailable ? "Apple Intelligence is ready." : "On-device models need a compatible iPhone or iPad.").foregroundStyle(.secondary)
            }
            if let selected {
                if models.preparingID == selected.id, case .loading(let p) = models.phase {
                    ProgressView(value: p) { Text("Preparing \(selected.name)").font(.footnote) }
                } else if models.isLoaded(selected.id) {
                    Label("\(selected.name) is ready", systemImage: "checkmark")
                } else {
                    if models.preparingID == selected.id, case .failed(let message) = models.phase {
                        Text(message).font(.footnote).foregroundStyle(.secondary)
                    }
                    Button("Prepare \(selected.name)") { prepare(selected.id) }
                }
            } else if OpenModels.supported && !Assistant.isAvailable {
                Text("Choose a model that fits this device.").font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Assistant").sectionTitle()
        } footer: {
            Text("Models download the first time you use them, then work offline.")
        }
    }

    private func prepare(_ id: String) { Task { _ = try? await models.container(for: id) } }

    private func tierRow(_ title: String, _ tier: Tier) -> some View {
        row(title, OpenModels.model(for: tier).name)
    }
    private func row(_ title: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            Text(sub).font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct ComputerRow: View {
    @Environment(Linker.self) private var link
    var pairing: Pairing
    @State private var confirming = false

    var body: some View {
        let on = (link.online[pairing.room] ?? 0) > 0
        HStack(spacing: 12) {
            Image(systemName: "laptopcomputer").font(.title3).foregroundStyle(.secondary).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(pairing.name)
                HStack(spacing: 5) {
                    Circle().fill(on ? Color.green : Color.secondary.opacity(0.5)).frame(width: 6, height: 6)
                    Text(on ? (link.lastSync.map { "Synced \($0.formatted(.relative(presentation: .named)))" } ?? "Connected") : "Offline")
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Menu {
                Button("Unlink", systemImage: "link.badge.minus", role: .destructive) { confirming = true }
            } label: { Image(systemName: "ellipsis").foregroundStyle(.secondary).frame(width: 30, height: 30) }
        }
        .confirmationDialog("Unlink \(pairing.name)?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Unlink", role: .destructive) { link.unlink(pairing) }
        } message: { Text("It stops syncing with this phone. Nothing is deleted on either device.") }
    }
}

// MARK: - Scanning

struct ScanSheet: View {
    @Environment(Linker.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var invalid = false

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    QRScanner { found($0) }
                        .ignoresSafeArea()
                        .overlay {
                            RoundedRectangle(cornerRadius: 28).strokeBorder(.white.opacity(0.85), lineWidth: 3)
                                .frame(width: 240, height: 240)
                        }
                        .overlay(alignment: .bottom) {
                            Text(invalid ? "That isn’t a Monolith code" : "Point at the code on your computer")
                                .font(.callout).padding(.horizontal, 16).padding(.vertical, 10)
                                .glassEffect(.regular, in: .capsule)
                                .padding(.bottom, 40)
                        }
                } else {
                    EmptyState(symbol: "qrcode.viewfinder", title: "Scan with the Camera app",
                               message: "Open the Camera and point it at the code on your computer. Monolith opens to finish linking.")
                }
            }
            .navigationTitle("Link a computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button("Paste link", systemImage: "doc.on.clipboard") {
                        if let s = UIPasteboard.general.string, let u = URL(string: s.trimmingCharacters(in: .whitespacesAndNewlines)) { found(u.absoluteString) }
                    }
                }
            }
        }
    }

    private func found(_ text: String) {
        guard let url = URL(string: text), let r = PairRequest(url: url) else {
            withAnimation { invalid = true }
            return
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        dismiss()
        link.pairState = .confirm
        link.request = r
    }
}

private struct QRScanner: UIViewControllerRepresentable {
    var onCode: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
                                           isHighFrameRateTrackingEnabled: false, isHighlightingEnabled: false)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }

    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        private var done = false
        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

        func dataScanner(_ s: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for case .barcode(let b) in items {
                guard let text = b.payloadStringValue, (text.hasPrefix("monolith://") || text.hasPrefix("socratic://")), !done else { continue }
                done = true
                s.stopScanning()
                onCode(text)
            }
        }
    }
}

// MARK: - Confirm and link

/// Shown after a code is scanned (in the app, or by the Camera opening a monolith:// link).
struct PairSheet: View {
    @Environment(Linker.self) private var link
    @Environment(\.dismiss) private var dismiss
    let request: PairRequest

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle().fill(.quaternary).frame(width: 72, height: 72)
                switch link.pairState {
                case .linked: Image(systemName: "checkmark").font(.title.weight(.semibold)).foregroundStyle(.green)
                case .failed: Image(systemName: "exclamationmark.circle").font(.title.weight(.semibold)).foregroundStyle(.orange)
                case .linking: ProgressView()
                case .confirm: Image(systemName: "laptopcomputer").font(.title)
                }
            }
            .contentTransition(.symbolEffect(.replace))
            .padding(.top, 28)

            VStack(spacing: 8) {
                Text(title).font(.sub).multilineTextAlignment(.center)
                Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 28)

            Spacer(minLength: 0)

            VStack(spacing: 10) {
                switch link.pairState {
                case .confirm:
                    Button { link.pair(request) } label: { Text("Link").frame(maxWidth: .infinity) }
                        .buttonStyle(.glassProminent).controlSize(.large)
                    Button("Cancel") { close() }.foregroundStyle(.secondary)
                case .linking:
                    Button("Cancel") { close() }.foregroundStyle(.secondary)
                case .linked, .failed:
                    Button { close() } label: { Text("Done").frame(maxWidth: .infinity) }
                        .buttonStyle(.glassProminent).controlSize(.large)
                }
            }
            .padding(.horizontal, 24).padding(.bottom, 20)
        }
        .tint(.primary)
        .animation(.snappy, value: link.pairState)
        .presentationDetents([.height(360)])
        .interactiveDismissDisabled(link.pairState == .linking)
    }

    private var title: String {
        switch link.pairState {
        case .confirm: "Link \(request.name)?"
        case .linking: "Linking…"
        case .linked: "Linked to \(request.name)"
        case .failed: "Couldn’t link"
        }
    }

    private var message: String {
        switch link.pairState {
        case .confirm: "It gets a copy of your notes, docs, lectures and calendar, and stays in sync. Only link computers you trust."
        case .linking: "Waiting for your computer to answer."
        case .linked: "Changes now sync both ways whenever Monolith is open on both. Use Sync mode to keep them in step overnight."
        case .failed(let why): why
        }
    }

    private func close() {
        link.request = nil
        dismiss()
    }
}

// MARK: - Sync mode

/// Like an overnight backup screen: stays awake, dims, drifts to spare the display, and needs Face ID to leave.
struct SyncModeView: View {
    @Environment(Linker.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var brightness: CGFloat = 0.5
    @State private var drift = CGSize.zero
    @State private var battery = UIDevice.current.batteryLevel
    @State private var charging = false
    private let tick = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 14) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 34, weight: .light))
                    .symbolEffect(.rotate, options: .repeat(.periodic(delay: 3)), isActive: link.anyOnline)
                Text(link.anyOnline ? "Syncing" : "Waiting for your computer").font(.sub)
                Text(detail).font(.footnote).multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.45))
            }
            .foregroundStyle(.white.opacity(0.75))
            .offset(drift)
            .animation(.easeInOut(duration: 4), value: drift)

            VStack {
                Spacer()
                if !charging {
                    Label("Plug in to keep syncing overnight", systemImage: "bolt")
                        .font(.caption).foregroundStyle(.white.opacity(0.4))
                        .padding(.bottom, 12)
                }
                Button { Task { await unlock() } } label: {
                    Label("Unlock", systemImage: "lock").font(.callout)
                        .padding(.horizontal, 18).padding(.vertical, 10)
                }
                .foregroundStyle(.white.opacity(0.6))
                .glassEffect(.clear, in: .capsule)
                .padding(.bottom, 30)
            }
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .onAppear(perform: enter)
        .onDisappear(perform: leave)
        .onReceive(tick) { _ in
            drift = CGSize(width: .random(in: -24...24), height: .random(in: -40...40))
            readBattery()
        }
    }

    private var detail: String {
        let n = link.pairings.filter { (link.online[$0.room] ?? 0) > 0 }.count
        var parts = [n == 0 ? "Open Monolith on your computer" : "\(n) computer\(n == 1 ? "" : "s") connected"]
        if let s = link.lastSync { parts.append("last change \(s.formatted(date: .omitted, time: .shortened))") }
        if battery >= 0 { parts.append("battery \(Int(battery * 100))%") }
        return parts.joined(separator: "\n")
    }

    private var screen: UIScreen? { (UIApplication.shared.connectedScenes.first { $0 is UIWindowScene } as? UIWindowScene)?.screen }

    private func enter() {
        UIApplication.shared.isIdleTimerDisabled = true
        UIDevice.current.isBatteryMonitoringEnabled = true
        readBattery()
        if let s = screen { brightness = s.brightness; s.brightness = 0.05 }
    }

    private func leave() {
        UIApplication.shared.isIdleTimerDisabled = false
        screen?.brightness = brightness
    }

    private func readBattery() {
        battery = UIDevice.current.batteryLevel
        charging = [.charging, .full].contains(UIDevice.current.batteryState)
    }

    private func unlock() async {
        let ctx = LAContext()
        var err: NSError?
        // No passcode on the device: nothing to protect with, just leave.
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { return dismiss() }
        if (try? await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Monolith")) == true { dismiss() }
    }
}

import SwiftUI
import AVFoundation
import WatchConnectivity

@main
struct MonolithWatchApp: App {
    @State private var link = WatchLink()
    var body: some Scene {
        WindowGroup {
            WatchHome().environment(link)
        }
    }
}

/// Watch side: shows the agenda the phone sends; sends recordings and dictated notes back.
@Observable
final class WatchLink: NSObject, WCSessionDelegate {
    var agenda: [AgendaEvent] = []
    var pending = 0

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func sendNote(_ text: String) {
        WCSession.default.transferUserInfo([Link.note: text])
    }

    func sendRecording(_ url: URL, title: String, duration: Double) {
        WCSession.default.transferFile(url, metadata: [Link.title: title, Link.duration: duration])
        pending = WCSession.default.outstandingFileTransfers.count
    }

    private func load(_ ctx: [String: Any]) {
        guard let data = ctx[Link.agenda] as? Data, let list = try? JSONDecoder().decode([AgendaEvent].self, from: data) else { return }
        agenda = list
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        let ctx = session.receivedApplicationContext
        Task { @MainActor in self.load(ctx) }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext ctx: [String: Any]) {
        Task { @MainActor in self.load(ctx) }
    }
    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        let n = session.outstandingFileTransfers.count
        Task { @MainActor in self.pending = n }
    }
}

struct WatchHome: View {
    @Environment(WatchLink.self) private var link
    @State private var note = ""

    var body: some View {
        NavigationStack {
            List {
                NavigationLink { RecordView() } label: {
                    Label("Record", systemImage: "mic.fill").foregroundStyle(.red).font(.headline)
                }
                TextField("Quick note", text: $note)
                    .onSubmit {
                        guard !note.isEmpty else { return }
                        link.sendNote(note)
                        note = ""
                    }

                Section {
                    if upcoming.isEmpty { Text("Nothing scheduled").foregroundStyle(.secondary) }
                    ForEach(upcoming) { e in
                        HStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: 1.5).fill(.blue).frame(width: 3)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(e.title).font(.headline).lineLimit(2)
                                Text(Calendar.current.isDateInToday(e.start) ? e.start.formatted(date: .omitted, time: .shortened) : e.start.formatted(.dateTime.weekday().hour().minute()))
                                    .font(.caption).foregroundStyle(.secondary)
                                if let l = e.location { Text(l).font(.caption2).foregroundStyle(.secondary) }
                            }
                        }
                    }
                } header: {
                    Text("Up next").font(.headline)
                }

                if link.pending > 0 {
                    Label("\(link.pending) sending to iPhone", systemImage: "arrow.up.circle").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Monolith")
        }
    }

    private var upcoming: [AgendaEvent] { link.agenda.filter { $0.end > .now } }
}

/// Records on the watch, then hands the file to the phone, which transcribes it.
struct RecordView: View {
    @Environment(WatchLink.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var recorder: AVAudioRecorder?
    @State private var start = Date()
    @State private var denied = false

    var body: some View {
        VStack(spacing: 10) {
            if recorder != nil {
                TimelineView(.periodic(from: start, by: 1)) { ctx in
                    Text(ctx.date.timeIntervalSince(start).clock)
                        .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
                }
                Text("Recording").font(.footnote).foregroundStyle(.red)
            } else {
                Text(denied ? "Allow the microphone in Settings" : "Tap to record").font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            Button {
                recorder == nil ? begin() : finish()
            } label: {
                Image(systemName: recorder == nil ? "mic.fill" : "stop.fill").font(.title2)
                    .frame(width: 64, height: 64)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .clipShape(.circle)
        }
        .navigationTitle("Record")
    }

    private func begin() {
        Task {
            guard await AVAudioApplication.requestRecordPermission() else { denied = true; return }
            let url = URL.temporaryDirectory.appending(path: "\(UUID().uuidString).m4a")
            let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 22050, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue]
            try? AVAudioSession.sharedInstance().setCategory(.record)
            try? AVAudioSession.sharedInstance().setActive(true)
            recorder = try? AVAudioRecorder(url: url, settings: settings)
            recorder?.record()
            start = .now
        }
    }

    private func finish() {
        guard let r = recorder else { return }
        let duration = r.currentTime
        r.stop()
        recorder = nil
        link.sendRecording(r.url, title: "Watch recording · \(Date.now.formatted(.dateTime.month(.abbreviated).day().hour().minute()))", duration: duration)
        dismiss()
    }
}

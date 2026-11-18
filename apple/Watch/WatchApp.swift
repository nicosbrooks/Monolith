import SwiftUI
import AVFoundation
import WatchConnectivity
import WatchKit

@main
struct MonolithWatchApp: App {
    @State private var link = WatchLink()
    @State private var recorder = WatchRecorder()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            WatchHome()
                .environment(link)
                .environment(recorder)
                .onChange(of: phase) { if phase == .active { link.sendWaiting() } }
        }
    }
}

// MARK: - Recordings kept on the watch

/// A recording made on the watch. The audio stays here until the phone says it has saved it, so nothing is lost
/// when the phone is out of reach, asleep or off: it goes over whenever they next see each other.
struct WatchRecording: Codable, Identifiable, Hashable {
    enum State: String, Codable { case waiting, sending, onPhone }
    var id: UUID
    var title: String
    var start: Date
    var duration: Double
    var file: String
    var state: State = .waiting
    var sentAt: Date?

    var url: URL { WatchRecording.folder.appending(path: file) }

    static let folder: URL = {
        let u = URL.documentsDirectory.appending(path: "Recordings", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
}

/// Watch side of the phone connection: the agenda the phone sends; recordings and quick notes going the other way.
@Observable
final class WatchLink: NSObject, WCSessionDelegate {
    var agenda: [AgendaEvent] = []
    private(set) var recordings: [WatchRecording] = []
    private let index = WatchRecording.folder.appending(path: "index.json")

    override init() {
        super.init()
        if let d = try? Data(contentsOf: index), let list = try? JSONDecoder().decode([WatchRecording].self, from: d) { recordings = list }
        // Ones on the phone for more than a week leave the list (their audio is already gone).
        recordings.removeAll { $0.state == .onPhone && ($0.sentAt ?? .distantPast) < .now.addingTimeInterval(-7 * 86400) }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// The event happening now, if any: a recording made during it is named after it.
    var now: AgendaEvent? { agenda.first { !$0.allDay && $0.start <= .now && $0.end > .now } }

    func sendNote(_ text: String) {
        WCSession.default.transferUserInfo([Link.note: text])
    }

    func add(_ r: WatchRecording) {
        recordings.insert(r, at: 0)
        save()
        send(r)
    }

    func delete(_ r: WatchRecording) {
        if r.state != .onPhone {
            for t in WCSession.default.outstandingFileTransfers where (t.file.metadata?[Link.id] as? String) == r.id.uuidString { t.cancel() }
        }
        try? FileManager.default.removeItem(at: r.url)
        recordings.removeAll { $0.id == r.id }
        save()
    }

    /// Anything not yet on the phone, and not already on its way, goes again.
    func sendWaiting() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        let going = Set(WCSession.default.outstandingFileTransfers.compactMap { $0.file.metadata?[Link.id] as? String })
        for r in recordings where r.state != .onPhone && !going.contains(r.id.uuidString) { send(r) }
    }

    private func send(_ r: WatchRecording) {
        guard WCSession.default.activationState == .activated, FileManager.default.fileExists(atPath: r.url.path) else { return }
        WCSession.default.transferFile(r.url, metadata: [Link.id: r.id.uuidString, Link.title: r.title, Link.duration: r.duration, Link.start: r.start.timeIntervalSince1970])
        set(r.id, .sending)
    }

    private func set(_ id: UUID, _ s: WatchRecording.State) {
        guard let i = recordings.firstIndex(where: { $0.id == id }), recordings[i].state != s else { return }
        recordings[i].state = s
        if s == .onPhone {
            recordings[i].sentAt = .now
            // The phone has it: the watch's copy can go.
            try? FileManager.default.removeItem(at: recordings[i].url)
            WKInterfaceDevice.current().play(.success)
        }
        save()
    }

    private func save() {
        if let d = try? JSONEncoder().encode(recordings) { try? d.write(to: index, options: .atomic) }
    }

    private func load(_ ctx: [String: Any]) {
        guard let data = ctx[Link.agenda] as? Data, let list = try? JSONDecoder().decode([AgendaEvent].self, from: data) else { return }
        agenda = list
    }

    // MARK: WCSessionDelegate (called off the main thread)

    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        let ctx = session.receivedApplicationContext
        Task { @MainActor in self.load(ctx); self.sendWaiting() }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext ctx: [String: Any]) {
        Task { @MainActor in self.load(ctx) }
    }
    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let raw = userInfo[Link.received] as? String, let id = UUID(uuidString: raw) else { return }
        Task { @MainActor in self.set(id, .onPhone) }
    }
    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        guard let raw = fileTransfer.file.metadata?[Link.id] as? String, let id = UUID(uuidString: raw) else { return }
        // Delivered is not yet saved: wait for the phone's word. A failed transfer waits to be sent again.
        if error != nil { Task { @MainActor in self.set(id, .waiting) } }
    }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in self.sendWaiting() }
    }
}

// MARK: - Recording

/// Records straight into the watch's own storage (not a temporary file), with a live level for the meter.
@Observable
final class WatchRecorder: NSObject, AVAudioRecorderDelegate {
    private(set) var recorder: AVAudioRecorder?
    private(set) var started = Date()
    private(set) var title = ""
    /// The last few seconds of loudness, 0...1, newest last.
    private(set) var levels: [Float] = Array(repeating: 0, count: 28)
    var denied = false
    private var meter: Timer?
    private var id = UUID()

    var isRecording: Bool { recorder != nil }

    func start(title: String) async {
        guard recorder == nil else { return }
        guard await AVAudioApplication.requestRecordPermission() else { denied = true; return }
        denied = false
        id = UUID()
        let url = WatchRecording.folder.appending(path: "\(id.uuidString).m4a")
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 22050, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue]
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.record, mode: .default)
        try? session.setActive(true)
        guard let r = try? AVAudioRecorder(url: url, settings: settings) else { return }
        r.delegate = self
        r.isMeteringEnabled = true
        guard r.record() else { return }
        recorder = r
        started = .now
        self.title = title
        levels = Array(repeating: 0, count: levels.count)
        WKInterfaceDevice.current().play(.start)
        meter = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.sample() }
        }
    }

    private func sample() {
        guard let r = recorder else { return }
        r.updateMeters()
        // -50 dB and below reads as silence.
        let level = max(0, min(1, (r.averagePower(forChannel: 0) + 50) / 50))
        levels.removeFirst()
        levels.append(level)
    }

    /// Stops and hands back the finished recording, or nil for one too short to keep.
    func stop() -> WatchRecording? {
        guard let r = recorder else { return nil }
        let duration = r.currentTime
        r.stop()
        meter?.invalidate()
        meter = nil
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        WKInterfaceDevice.current().play(.stop)
        guard duration >= 1 else { try? FileManager.default.removeItem(at: r.url); return nil }
        return WatchRecording(id: id, title: title, start: started, duration: duration, file: r.url.lastPathComponent)
    }
}

// MARK: - Screens

struct WatchHome: View {
    @Environment(WatchLink.self) private var link
    @Environment(WatchRecorder.self) private var recorder
    @State private var note = ""
    @State private var recording = false

    var body: some View {
        NavigationStack {
            List {
                Button { recording = true } label: { recordButton }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())

                if !link.recordings.isEmpty {
                    Section {
                        ForEach(link.recordings) { RecordingRow(recording: $0) }
                            .onDelete { $0.map { link.recordings[$0] }.forEach(link.delete) }
                    } header: { Text("Recordings") }
                }

                Section {
                    if upcoming.isEmpty { Text("Nothing scheduled").foregroundStyle(.secondary) }
                    ForEach(upcoming) { e in EventRow(event: e) }
                } header: { Text("Up next") }

                TextField("Quick note", text: $note)
                    .onSubmit {
                        let t = note.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !t.isEmpty else { return }
                        link.sendNote(t)
                        note = ""
                        WKInterfaceDevice.current().play(.success)
                    }
            }
            .navigationTitle("Monolith")
            .navigationDestination(isPresented: $recording) { RecordView() }
        }
    }

    /// The one big thing on the watch: start recording. During an event it says which.
    private var recordButton: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(.red).frame(width: 44, height: 44)
                Image(systemName: recorder.isRecording ? "waveform" : "mic.fill").font(.title3.weight(.semibold)).foregroundStyle(.white)
                    .symbolEffect(.variableColor.iterative, isActive: recorder.isRecording)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(recorder.isRecording ? "Recording" : "Record").font(.headline)
                if recorder.isRecording {
                    TimelineView(.periodic(from: recorder.started, by: 1)) { ctx in
                        Text(ctx.date.timeIntervalSince(recorder.started).clock).font(.footnote.monospacedDigit()).foregroundStyle(.red)
                    }
                } else if let e = link.now {
                    Text(e.title).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(.red.opacity(0.16), in: .rect(cornerRadius: 22))
        .accessibilityLabel(recorder.isRecording ? "Recording, open" : "Record")
    }

    private var upcoming: [AgendaEvent] { Array(link.agenda.filter { $0.end > .now }.prefix(4)) }
}

private struct EventRow: View {
    var event: AgendaEvent
    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 1.5).fill(.blue).frame(width: 3)
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title).font(.headline).lineLimit(2)
                Text(Calendar.current.isDateInToday(event.start) ? event.start.formatted(date: .omitted, time: .shortened) : event.start.formatted(.dateTime.weekday().hour().minute()))
                    .font(.caption).foregroundStyle(.secondary)
                if let l = event.location { Text(l).font(.caption2).foregroundStyle(.secondary) }
            }
        }
    }
}

/// A recording on the list: its name, how long, and where it is (waiting for the phone, on its way, on the phone).
private struct RecordingRow: View {
    var recording: WatchRecording
    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(recording.title).font(.headline).lineLimit(2)
                Text("\(recording.duration.clock) · \(status)").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Image(systemName: symbol).font(.footnote).foregroundStyle(recording.state == .onPhone ? .green : .secondary)
                .symbolEffect(.pulse, isActive: recording.state == .sending)
        }
        .accessibilityElement(children: .combine)
    }
    private var status: String {
        switch recording.state {
        case .waiting: "Waiting for iPhone"
        case .sending: "Sending"
        case .onPhone: "On iPhone"
        }
    }
    private var symbol: String {
        switch recording.state {
        case .waiting: "clock"
        case .sending: "arrow.up.circle"
        case .onPhone: "checkmark.circle.fill"
        }
    }
}

/// Recording: starts as soon as it opens. A big timer, a live meter, one Stop button. Stopping saves it on the watch
/// and sends it to the phone, which transcribes it and writes the notes.
struct RecordView: View {
    @Environment(WatchLink.self) private var link
    @Environment(WatchRecorder.self) private var recorder
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 8) {
            if recorder.denied {
                Text("Allow the microphone for Monolith in Settings on your watch.").font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            } else {
                Text(recorder.title.isEmpty ? "Recording" : recorder.title).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                TimelineView(.periodic(from: recorder.started, by: 1)) { ctx in
                    Text((recorder.isRecording ? ctx.date.timeIntervalSince(recorder.started) : 0).clock)
                        .font(.system(size: 36, weight: .semibold, design: .rounded).monospacedDigit())
                }
                Meter(levels: recorder.levels).frame(height: 26)
            }
            Button {
                if recorder.isRecording { finish() } else { begin() }
            } label: {
                Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill").font(.title2)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .accessibilityLabel(recorder.isRecording ? "Stop and send to iPhone" : "Record")
        }
        .padding(.horizontal, 4)
        .navigationTitle("Record")
        .task { if !recorder.isRecording { begin() } }
    }

    private func begin() {
        let title = link.now?.title ?? "Watch recording · \(Date.now.formatted(.dateTime.month(.abbreviated).day().hour().minute()))"
        Task { await recorder.start(title: title) }
    }

    private func finish() {
        if let r = recorder.stop() { link.add(r) }
        dismiss()
    }
}

/// Bars for the last few seconds of sound, so you can see it's hearing you.
private struct Meter: View {
    var levels: [Float]
    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(Array(levels.enumerated()), id: \.offset) { _, l in
                Capsule().fill(.red.opacity(0.85))
                    .frame(width: 3, height: max(3, CGFloat(l) * 26))
            }
        }
        .animation(.linear(duration: 0.12), value: levels)
        .accessibilityHidden(true)
    }
}

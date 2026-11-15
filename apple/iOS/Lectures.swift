import SwiftUI
import AVFoundation
import Speech
import UniformTypeIdentifiers

/// Where the audio thread writes. Kept apart from the recorder so the tap never touches main-actor state.
nonisolated private final class AudioSink: @unchecked Sendable {
    private let lock = NSLock()
    private var file: AVAudioFile?
    private var request: SFSpeechAudioBufferRecognitionRequest?

    func set(file: AVAudioFile?) { lock.withLock { self.file = file } }
    func set(request: SFSpeechAudioBufferRecognitionRequest?) { lock.withLock { self.request = request } }
    func write(_ buffer: AVAudioPCMBuffer) {
        lock.withLock {
            try? file?.write(from: buffer)
            request?.append(buffer)
        }
    }
}

/// Records a lecture to an audio file while transcribing it live, on device.
@Observable
final class LectureRecorder {
    private(set) var item: Item?
    private(set) var isRecording = false
    /// False when speech recognition is off or unavailable; the audio is still recorded.
    private(set) var transcribing = false
    private(set) var elapsed: Double = 0
    private(set) var live = "" // words not yet final
    var error: String?

    private let engine = AVAudioEngine()
    private let sink = AudioSink()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var segmentStart: Double = 0
    private var startedAt = Date()
    private var timer: Timer?
    private var starting = false
    /// This stretch of audio, when adding to a lecture that already has a recording.
    private var part: URL?
    /// Goes up whenever recognition restarts or ends, so late answers from an older request are ignored.
    private var run = 0
    /// Recognition attempts in a row that ended at once with nothing.
    private var misses = 0
    private let recognizer = SFSpeechRecognizer(locale: .current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))

    init() {
        // A phone call, Siri, or the microphone changing (AirPods in or out) stops the engine. Save what we have.
        let center = NotificationCenter.default
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let began = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
            MainActor.assumeIsolated { if began, self?.isRecording == true { self?.stop() } }
        }
        center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { if self?.isRecording == true { self?.stop() } }
        }
    }

    func start(_ item: Item) {
        guard !isRecording, !starting else { return }
        starting = true
        Task {
            defer { starting = false }
            guard await AVAudioApplication.requestRecordPermission() else {
                error = "Microphone access is off. Turn it on in Settings → Apps → Monolith."
                return
            }
            let speech = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
            do {
                try begin(item, transcribe: speech == .authorized)
            } catch {
                self.error = "Couldn’t start recording. \(error.localizedDescription)"
                stop()
            }
        }
    }

    private func begin(_ item: Item, transcribe: Bool) throws {
        settle()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw CocoaError(.featureUnsupported, userInfo: [NSLocalizedDescriptionKey: "No microphone is available."]) }
        // Recording again into a lecture that has audio: keep the earlier audio and join this stretch on when it stops.
        let hasAudio = item.audioURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
        let name = hasAudio ? "\(item.id.uuidString)-part-\(Int(Date.now.timeIntervalSince1970)).caf" : "\(item.id.uuidString).caf"
        let url = Storage.audio.appending(path: name)
        sink.set(file: try AVAudioFile(forWriting: url, settings: format.settings))
        if hasAudio { part = url } else { item.audioFile = name; part = nil }

        self.item = item
        startedAt = .now
        elapsed = item.duration
        misses = 0
        transcribing = false
        if transcribe { newRequest() }

        let sink = sink
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in sink.write(buffer) }
        engine.prepare()
        try engine.start()
        isRecording = true
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let item = self.item else { return }
                self.elapsed = item.duration + Date.now.timeIntervalSince(self.startedAt)
            }
        }
    }

    /// One recognition request per stretch of speech; a new one starts when the last ends.
    private func newRequest() {
        guard let recognizer, recognizer.isAvailable else { transcribing = false; return }
        let r = SFSpeechAudioBufferRecognitionRequest()
        r.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        r.shouldReportPartialResults = true
        r.addsPunctuation = true
        request = r
        sink.set(request: r)
        transcribing = true
        segmentStart = isRecording ? (item?.duration ?? 0) + Date.now.timeIntervalSince(startedAt) : elapsed
        run += 1
        let mine = run
        let began = Date.now
        task = recognizer.recognitionTask(with: r) { [weak self] result, err in
            let text = result?.bestTranscription.formattedString ?? ""
            let ended = result?.isFinal == true || err != nil
            let lines = ended ? (result.map { LectureRecorder.lines($0.bestTranscription) } ?? []) : []
            Task { @MainActor in self?.heard(mine, text: text, ended: ended, lines: lines, began: began) }
        }
    }

    private func heard(_ mine: Int, text: String, ended: Bool, lines: [(start: Double, text: String)], began: Date) {
        guard run == mine else { return }
        guard ended else {
            // Some recognizers start over after a long pause. Keep what was there rather than lose it.
            if live.count > 40, text.count < live.count / 2 {
                commit([(0, live)])
                segmentStart = (item?.duration ?? 0) + (isRecording ? Date.now.timeIntervalSince(startedAt) : 0)
            }
            live = text
            return
        }
        // Sentences with their own times if we got them; otherwise whatever text there is.
        commit(!lines.isEmpty ? lines : !text.isEmpty ? [(0, text)] : !live.isEmpty ? [(0, live)] : [])
        live = ""
        run += 1
        guard isRecording else { return }
        // If recognition keeps ending straight away with nothing, it isn't going to work. Keep recording the audio.
        misses = text.isEmpty && Date.now.timeIntervalSince(began) < 2 ? misses + 1 : 0
        if misses < 4 {
            newRequest()
        } else {
            request = nil
            sink.set(request: nil)
            transcribing = false
        }
    }

    private func commit(_ lines: [(start: Double, text: String)]) {
        guard let item, !lines.isEmpty else { return }
        item.transcript.append(contentsOf: lines.map { Segment(start: segmentStart + $0.start, text: $0.text) })
        item.touch()
    }

    /// Writes down anything still waiting from the last recording, and stops listening for more of it.
    private func settle() {
        if !live.isEmpty { commit([(0, live)]) }
        live = ""
        run += 1
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        if engine.isRunning {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        if let item, isRecording {
            item.duration += Date.now.timeIntervalSince(startedAt)
            item.touch()
        }
        isRecording = false
        transcribing = false
        sink.set(file: nil)
        sink.set(request: nil)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        // Let the recognizer hand over its final wording. If it doesn't answer, keep what was on screen.
        let mine = run
        request?.endAudio()
        task?.finish()
        request = nil
        Task {
            try? await Task.sleep(for: .seconds(3))
            if run == mine { settle() }
        }
        if let part, let item {
            self.part = nil
            Task { await join(part, into: item) }
        }
    }

    /// Adds a new stretch of audio to the end of a lecture's recording.
    private func join(_ part: URL, into item: Item) async {
        guard let old = item.audioURL else { return }
        let both = AVMutableComposition()
        do {
            guard let track = both.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw CocoaError(.fileWriteUnknown) }
            var at = CMTime.zero
            for url in [old, part] {
                let asset = AVURLAsset(url: url)
                guard let source = try await asset.loadTracks(withMediaType: .audio).first else { continue }
                let length = try await asset.load(.duration)
                try track.insertTimeRange(CMTimeRange(start: .zero, duration: length), of: source, at: at)
                at = at + length
            }
            let name = "\(item.id.uuidString)-\(Int(Date.now.timeIntervalSince1970)).m4a"
            guard let export = AVAssetExportSession(asset: both, presetName: AVAssetExportPresetAppleM4A) else { throw CocoaError(.fileWriteUnknown) }
            try await export.export(to: Storage.audio.appending(path: name), as: .m4a)
            item.audioFile = name
            try? FileManager.default.removeItem(at: old)
            try? FileManager.default.removeItem(at: part)
        } catch {
            // Both files stay on disk and the lecture keeps playing the earlier one.
            self.error = "The new audio was saved, but couldn’t be joined to the earlier recording."
        }
    }

    /// A transcription as sentence-sized lines with their start times.
    nonisolated static func lines(_ t: SFTranscription) -> [(start: Double, text: String)] {
        var out: [(start: Double, text: String)] = []
        var cur = "", start = 0.0
        for s in t.segments {
            if cur.isEmpty { start = s.timestamp }
            cur += (cur.isEmpty ? "" : " ") + s.substring
            if s.substring.last.map({ ".?!".contains($0) }) == true || cur.count > 220 {
                out.append((start, cur))
                cur = ""
            }
        }
        if !cur.isEmpty { out.append((start, cur)) }
        return out
    }

    /// Transcribes an audio file after the fact, e.g. a recording sent from the watch.
    static func transcribe(_ url: URL) async -> [Segment] {
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else { return [] }
        let r = SFSpeechURLRecognitionRequest(url: url)
        r.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        r.addsPunctuation = true
        let lines: [(start: Double, text: String)] = await withCheckedContinuation { c in
            var done = false
            recognizer.recognitionTask(with: r) { result, err in
                guard !done else { return }
                if let result, result.isFinal {
                    done = true
                    c.resume(returning: LectureRecorder.lines(result.bestTranscription))
                } else if err != nil {
                    done = true
                    c.resume(returning: [])
                }
            }
        }
        return lines.map { Segment(start: $0.start, text: $0.text) }
    }
}

/// Plays a lecture's audio and says whether it's playing, so the button can show it.
@Observable
final class Playback: NSObject, AVAudioPlayerDelegate {
    private(set) var isPlaying = false
    private var player: AVAudioPlayer?
    private var url: URL?
    var position: Double { player?.currentTime ?? 0 }
    var duration: Double { player?.duration ?? 0 }

    func toggle(_ url: URL) {
        if isPlaying { pause() } else { play(url, from: self.url == url ? player?.currentTime ?? 0 : 0) }
    }

    func play(_ url: URL, from t: Double) {
        if self.url != url || player == nil {
            player = try? AVAudioPlayer(contentsOf: url)
            player?.delegate = self
            self.url = url
        }
        guard let player else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        player.currentTime = min(max(0, t), max(0, player.duration - 0.1))
        isPlaying = player.play()
    }

    func pause() {
        player?.pause()
        isPlaying = false
    }

    func seek(_ time: Double, in url: URL) {
        if self.url != url || player == nil {
            player = try? AVAudioPlayer(contentsOf: url)
            player?.delegate = self
            self.url = url
        }
        guard let player else { return }
        player.currentTime = min(max(0, time), max(0, player.duration - 0.1))
    }

    func stop() {
        player?.stop()
        player = nil
        isPlaying = false
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.isPlaying = false }
    }
}

struct LectureView: View {
    @Bindable var item: Item
    @Environment(LectureRecorder.self) private var recorder
    @State private var playback = Playback()
    @State private var tab = 0
    @State private var working = false
    @State private var notesError: String?
    @State private var scrubPosition: Double?
    @State private var scrubbing = false
    @State private var importing = false
    @State private var transcribing = false
    @Environment(\.dismiss) private var dismiss

    private var recordingThis: Bool { recorder.isRecording && recorder.item?.id == item.id }

    var body: some View {
        List {
            Section {
                TextField("Title", text: $item.title, axis: .vertical).font(.title2.bold())
                    .onChange(of: item.title) { if item.title.contains(where: \.isNewline) { item.title = item.title.filter { !$0.isNewline } } }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 0, trailing: 20))
                controls
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 8, trailing: 20))
                if !item.transcript.isEmpty {
                    Picker("View", selection: $tab) {
                        Text("Transcript").tag(0)
                        Text("Notes").tag(1)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
                }
            }

            if tab == 0 {
                Section {
                    ForEach(Array(item.transcript.enumerated()), id: \.offset) { _, seg in
                        Button { play(from: seg.start) } label: {
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Text(seg.start.clock).font(.caption.monospacedDigit()).foregroundStyle(.tertiary).frame(width: 44, alignment: .leading)
                                Text(seg.text).foregroundStyle(.primary)
                            }
                        }
                    }
                    if recordingThis && !recorder.live.isEmpty {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Circle().fill(.red).frame(width: 6, height: 6).frame(width: 44, alignment: .leading)
                            Text(recorder.live).foregroundStyle(.secondary)
                        }
                    }
                    if item.transcript.isEmpty && !recordingThis && item.audioFile != nil {
                        Text("No transcript yet.").foregroundStyle(.secondary)
                    }
                }
            } else {
                Section {
                    if let notes = item.studyNotes {
                        MarkdownBlocks(markdown: notes)
                    } else if Assistant.isAvailable {
                        Button { Task { await makeNotes() } } label: {
                            Label(working ? "Writing notes…" : "Write notes", systemImage: "sparkles")
                        }
                        .disabled(working)
                        if let notesError {
                            Text(notesError).font(.footnote).foregroundStyle(.secondary)
                        }
                    } else {
                        Text(Assistant.ModelError.unavailable.localizedDescription)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listStyle(.plain)
        .paper()
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: item.title) { item.touch() }
        .onDisappear { playback.stop() }
        .onChange(of: recordingThis) { if recordingThis { playback.stop() } }
        .onAppear(perform: measure)
        // The web app's recording menu: Record again, Transcribe again, Use an audio file, then Pin and Delete.
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ItemMenu(item: item, onDelete: { dismiss() }, extra: AnyView(Group {
                        if item.audioFile != nil && !recorder.isRecording {
                            Button("Record again", systemImage: "mic") { playback.stop(); recorder.start(item) }
                            Button(transcribing ? "Transcribing…" : "Transcribe again", systemImage: "captions.bubble") { Task { await retranscribe() } }
                                .disabled(transcribing)
                        }
                        if !recordingThis {
                            Button("Use an audio file", systemImage: "square.and.arrow.up") { importing = true }
                        }
                    }))
                } label: { Image(systemName: "ellipsis") }
                .accessibilityLabel("More options")
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.audio]) { result in
            guard case .success(let src) = result else { return }
            Task { await useAudio(src) }
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            transport
            if let url = item.audioURL, !recordingThis {
                TimelineView(.periodic(from: .now, by: 0.25)) { _ in
                    let duration = max(playback.duration, item.duration, 1)
                    let position = scrubPosition ?? playback.position
                    VStack(spacing: 2) {
                        Slider(value: Binding(get: { position }, set: { value in
                            if scrubbing { scrubPosition = value }
                            else { playback.seek(value, in: url) }
                        }), in: 0...duration) { editing in
                            scrubbing = editing
                            if !editing, let scrubPosition { playback.seek(scrubPosition, in: url); self.scrubPosition = nil }
                        }
                        .accessibilityLabel("Playback position")
                        HStack {
                            Text(position.clock)
                            Spacer()
                            Text(duration.clock)
                        }
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(14)
        .background(Theme.raised, in: .rect(cornerRadius: 18))
    }

    private var transport: some View {
        HStack(spacing: 14) {
            Button {
                recordingThis ? recorder.stop() : recorder.start(item)
            } label: {
                Image(systemName: recordingThis ? "stop.fill" : "mic.fill")
                    .font(.title3).foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(.red, in: .circle)
            }
            .buttonStyle(.plain)
            .disabled(recorder.isRecording && !recordingThis)
            .accessibilityLabel(recordingThis ? "Stop recording" : "Record")

            VStack(alignment: .leading, spacing: 2) {
                Text((recordingThis ? recorder.elapsed : item.duration).clock).font(.title3.monospacedDigit().weight(.semibold))
                if recordingThis { Text("Recording").font(.footnote).foregroundStyle(.red) }
            }
            Spacer()
            if item.audioFile != nil && !recordingThis {
                Button { if let url = item.audioURL { playback.toggle(url) } } label: {
                    Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill").frame(width: 44, height: 44)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.glass)
                .accessibilityLabel(playback.isPlaying ? "Pause" : "Play")
            }
        }
    }

    private func play(from t: Double) {
        guard !recordingThis, let url = item.audioURL else { return }
        playback.play(url, from: t)
    }

    /// A recording cut short (the app was closed mid-lecture) has audio but no length yet.
    private func measure() {
        guard item.duration == 0, !recordingThis, let url = item.audioURL, let file = try? AVAudioFile(forReading: url) else { return }
        item.duration = Double(file.length) / file.fileFormat.sampleRate
    }

    private func retranscribe() async {
        guard let url = item.audioURL else { return }
        transcribing = true
        defer { transcribing = false }
        let segs = await LectureRecorder.transcribe(url)
        if segs.isEmpty { Toaster.shared.show("Couldn\u{2019}t transcribe this recording"); return }
        let old = item.transcript
        item.transcript = segs
        item.touch()
        Toaster.shared.show("Transcript updated", action: ("Undo", { [item] in item.transcript = old }))
    }

    /// Copies a picked audio file in as this recording's audio, then transcribes it.
    private func useAudio(_ src: URL) async {
        let ok = src.startAccessingSecurityScopedResource()
        defer { if ok { src.stopAccessingSecurityScopedResource() } }
        let name = "\(item.id.uuidString)-import-\(Int(Date.now.timeIntervalSince1970)).\(src.pathExtension.isEmpty ? "m4a" : src.pathExtension)"
        let dest = Storage.audio.appending(path: name)
        do { try FileManager.default.copyItem(at: src, to: dest) } catch { Toaster.shared.show("Couldn\u{2019}t use that file"); return }
        playback.stop()
        item.audioFile = name
        item.duration = 0
        measure()
        item.touch()
        Toaster.shared.show("Audio added", detail: "Transcribing…")
        await retranscribe()
    }

    private func makeNotes() async {
        working = true
        notesError = nil
        defer { working = false }
        let text = item.transcript.map(\.text).joined(separator: " ")
        do {
            item.studyNotes = try await Assistant.studyNotes(for: text)
            item.touch()
        } catch {
            notesError = error.localizedDescription
        }
    }
}

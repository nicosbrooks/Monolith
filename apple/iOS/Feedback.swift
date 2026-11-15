import SwiftUI
import SwiftData
import AVFoundation

/// A small pill in the upper right after something happens, with Undo when it can be taken back.
/// Same as the web app's toasts: "Doc moved to Recently Deleted · Undo", "Copied as Markdown".
@Observable
final class Toaster {
    static let shared = Toaster()
    struct Toast: Identifiable {
        let id = UUID()
        var title: String
        var detail: String?
        var action: (label: String, run: () -> Void)?
    }
    private(set) var current: Toast?

    func show(_ title: String, detail: String? = nil, action: (label: String, run: () -> Void)? = nil) {
        let t = Toast(title: title, detail: detail, action: action)
        withAnimation(.snappy) { current = t }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(action == nil ? 2.5 : 6))
            if current?.id == t.id { withAnimation(.snappy) { current = nil } }
        }
    }

    func dismiss() { withAnimation(.snappy) { current = nil } }
}

struct ToastView: View {
    var toast: Toaster.Toast
    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(toast.title).font(.subheadline.weight(.medium)).lineLimit(1)
                if let d = toast.detail { Text(d).font(.footnote).foregroundStyle(.secondary).lineLimit(1) }
            }
            if let a = toast.action {
                Button(a.label) { a.run(); Toaster.shared.dismiss() }
                    .font(.footnote.weight(.semibold)).buttonStyle(.plain)
                    .padding(.horizontal, 12).frame(height: 30)
                    .background(Color.primary.opacity(0.12), in: .capsule)
            }
        }
        .padding(.leading, 16).padding(.trailing, toast.action == nil ? 16 : 7)
        .frame(minHeight: 44)
        .background(Theme.raised, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.rule))
        .shadow(color: .black.opacity(0.3), radius: 14, y: 6)
        .onTapGesture { Toaster.shared.dismiss() }
    }
}

extension Item {
    /// Moves it to Recently Deleted and offers Undo, like the web app.
    func trash() {
        deletedAt = .now
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        let what = kind == .lecture ? "Recording" : "Doc"
        Toaster.shared.show("\(what) moved to Recently Deleted", action: ("Undo", { [weak self] in self?.deletedAt = nil }))
    }

    func toggleFavorite() {
        pinned.toggle()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}

/// Reads a doc aloud (the web app's Listen button).
@Observable
final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = Speaker()
    private let synth = AVSpeechSynthesizer()
    private(set) var speakingID: UUID?
    override init() { super.init(); synth.delegate = self }

    func toggle(_ item: Item) {
        if speakingID == item.id { synth.stopSpeaking(at: .immediate); speakingID = nil; return }
        synth.stopSpeaking(at: .immediate)
        let plain = item.body.replacingOccurrences(of: #"[#>*_`\[\]|-]"#, with: " ", options: .regularExpression)
        synth.speak(AVSpeechUtterance(string: "\(item.displayTitle). \(plain)"))
        speakingID = item.id
    }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        Task { @MainActor in self.speakingID = nil }
    }
}

extension Event {
    /// Deletes it and offers Undo, which puts back a copy.
    func trash(_ ctx: ModelContext) {
        let copy = (title, start, end, allDay, location, notes, linkedItemID, color)
        ctx.delete(self)
        PhoneLink.shared.sendAgenda()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        Toaster.shared.show("Event deleted", action: ("Undo", {
            let e = Event(title: copy.0, start: copy.1, end: copy.2)
            e.allDay = copy.3; e.location = copy.4; e.notes = copy.5; e.linkedItemID = copy.6; e.color = copy.7
            ctx.insert(e)
            PhoneLink.shared.sendAgenda()
        }))
    }
}

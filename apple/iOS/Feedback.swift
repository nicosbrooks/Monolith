import SwiftUI
import SwiftData
import AVFoundation

/// A short note just above the chat bar after something happens, with Undo when it can be taken back.
/// Same as the web app's notifications: "Doc moved to Recently Deleted · Undo", "Copied as Markdown".
/// `error` marks something that didn't work: a red alert icon, and it stays a little longer.
@Observable
final class Toaster {
    static let shared = Toaster()
    struct Toast: Identifiable {
        let id = UUID()
        var title: String
        var detail: String?
        var action: (label: String, run: () -> Void)?
        var error = false
    }
    private(set) var current: Toast?

    func show(_ title: String, detail: String? = nil, action: (label: String, run: () -> Void)? = nil, error: Bool = false) {
        let t = Toast(title: title, detail: detail, action: action, error: error)
        withAnimation(.snappy) { current = t }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(action == nil && !error ? 2.5 : 6))
            if current?.id == t.id { withAnimation(.snappy) { current = nil } }
        }
    }

    func dismiss() { withAnimation(.snappy) { current = nil } }
}

struct ToastView: View {
    var toast: Toaster.Toast
    var body: some View {
        HStack(spacing: 10) {
            if toast.error {
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red).font(.subheadline)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(toast.title).font(.subheadline.weight(.medium)).lineLimit(2)
                if let d = toast.detail { Text(d).font(.footnote).foregroundStyle(.secondary).lineLimit(1) }
            }
            // The one thing you can press, filled so it reads as a button.
            if let a = toast.action {
                Button(a.label) { Haptics.tap(); a.run(); Toaster.shared.dismiss() }
                    .font(.footnote.weight(.semibold)).buttonStyle(.plain)
                    .foregroundStyle(Color(uiColor: .systemBackground))
                    .padding(.horizontal, 14).frame(height: 30)
                    .background(Color.primary, in: .capsule)
            }
        }
        .padding(.leading, 16).padding(.trailing, toast.action == nil ? 16 : 7).padding(.vertical, 7)
        .frame(minHeight: 44)
        // The same glass as the chat bar it rises out of.
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .onTapGesture { Toaster.shared.dismiss() }
    }
}

extension Item {
    /// Moves it to Recently Deleted and offers Undo, like the web app.
    @MainActor func trash() {
        deletedAt = .now
        Haptics.thud()
        let what = kind == .lecture ? "Recording" : "Doc"
        Toaster.shared.show("\(what) moved to Recently Deleted", action: ("Undo", { [weak self] in self?.deletedAt = nil }))
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
    @MainActor func trash(_ ctx: ModelContext) {
        let copy = (title, start, end, allDay, location, notes, linkedItemID, color)
        ctx.delete(self)
        PhoneLink.shared.sendAgenda()
        Haptics.thud()
        Toaster.shared.show("Event deleted", action: ("Undo", {
            let e = Event(title: copy.0, start: copy.1, end: copy.2)
            e.allDay = copy.3; e.location = copy.4; e.notes = copy.5; e.linkedItemID = copy.6; e.color = copy.7
            ctx.insert(e)
            PhoneLink.shared.sendAgenda()
        }))
    }
}

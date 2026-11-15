import Foundation
import SwiftData
import WatchConnectivity

/// Phone side of the watch connection: sends today's agenda, receives recordings and quick notes.
final class PhoneLink: NSObject, WCSessionDelegate {
    static let shared = PhoneLink()
    private var ctx: ModelContext?

    func start(context: ModelContext) {
        ctx = context
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func sendAgenda() {
        guard let ctx, WCSession.isSupported(), WCSession.default.activationState == .activated, WCSession.default.isPaired else { return }
        let from = Calendar.current.startOfDay(for: .now)
        let to = from.addingTimeInterval(2 * 86400)
        let events = (try? ctx.fetch(FetchDescriptor<Event>(predicate: #Predicate { $0.start >= from && $0.start < to }, sortBy: [SortDescriptor(\.start)]))) ?? []
        guard let data = try? JSONEncoder().encode(events.map(\.agenda)) else { return }
        try? WCSession.default.updateApplicationContext([Link.agenda: data])
    }

    // MARK: WCSessionDelegate (called off the main thread)

    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.sendAgenda() }
    }
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let text = userInfo[Link.note] as? String else { return }
        Task { @MainActor in
            let lines = text.components(separatedBy: "\n")
            self.ctx?.insert(Item(.doc, title: String(lines[0].prefix(80)), body: Block.tidy(lines.dropFirst().joined(separator: "\n"))))
        }
    }

    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        // The file is deleted when this returns, so move it first.
        let name = "\(UUID().uuidString).\(file.fileURL.pathExtension)"
        let dest = Storage.audio.appending(path: name)
        guard (try? FileManager.default.moveItem(at: file.fileURL, to: dest)) != nil else { return }
        let title = file.metadata?[Link.title] as? String
        let duration = file.metadata?[Link.duration] as? Double ?? 0
        Task { @MainActor in
            let item = Item(.lecture, title: title ?? "Watch recording · \(Date.now.formatted(.dateTime.month(.abbreviated).day()))")
            item.audioFile = name
            item.duration = duration
            self.ctx?.insert(item)
            item.transcript = await LectureRecorder.transcribe(dest)
            item.touch()
        }
    }
}

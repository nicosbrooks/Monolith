import Foundation

/// What the phone and watch send each other over WatchConnectivity.
nonisolated enum Link {
    /// applicationContext key: today's agenda as JSON-encoded [AgendaEvent]
    static let agenda = "agenda"
    /// transferUserInfo key: a quick note dictated on the watch
    static let note = "note"
    /// transferFile metadata keys for a recording made on the watch
    static let title = "title"
    static let duration = "duration"
}

struct AgendaEvent: Codable, Hashable, Identifiable {
    var id: UUID
    var title: String
    var start: Date
    var end: Date
    var allDay: Bool
    var location: String?
}

extension Double {
    /// 1:05:09 or 5:09
    var clock: String {
        let s = Int(self.rounded())
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }
}

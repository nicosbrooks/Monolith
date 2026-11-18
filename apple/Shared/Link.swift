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
    /// The recording's id on the watch, and when it started (seconds since 1970).
    static let id = "id"
    static let start = "start"
    /// applicationContext keys: the look and accent chosen on the phone (ids from `Palette`), so the watch matches.
    static let look = "look"
    static let tint = "tint"
    /// transferUserInfo key, phone → watch: the id of a recording the phone has saved. Until then the watch keeps it.
    static let received = "received"
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

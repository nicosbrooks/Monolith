import Foundation
import SwiftData

enum ItemKind: String, Codable, CaseIterable {
    /// Notes were merged into docs. Kept only so older records and older devices still decode; nothing creates one.
    case note
    case doc, lecture

    var label: String { rawValue.capitalized }
    var symbol: String {
        switch self {
        case .note: "note.text"
        case .doc: "doc.text"
        case .lecture: "mic"
        }
    }
}

/// A line of transcript, `start` seconds into the recording.
struct Segment: Codable, Hashable {
    var start: Double
    var text: String
}

/// Notes, docs and lectures share one model, like the web app. Bodies are Markdown.
@Model
final class Item {
    var id = UUID()
    var kindRaw = ItemKind.doc.rawValue
    var title = ""
    var body = ""
    var emoji: String?
    var displayEmoji: String? {
        guard kind != .lecture, emoji != "📄", !(recID == "doc-guide" && emoji == "📘") else { return nil }
        return emoji
    }
    var pinned = false
    var folder: String?
    var createdAt = Date()
    var updatedAt = Date()
    var deletedAt: Date?

    var parent: Item?
    @Relationship(deleteRule: .cascade, inverse: \Item.parent) var children: [Item]? = []

    // Lectures
    var audioFile: String?
    var duration: Double = 0
    var transcript: [Segment] = []
    var studyNotes: String?

    /// PencilKit drawing for a note's sketch area
    var drawing: Data?

    /// Id on linked computers, for items that started there.
    var syncID: String?

    var kind: ItemKind {
        get { ItemKind(rawValue: kindRaw).map { $0 == .note ? .doc : $0 } ?? .doc }
        set { kindRaw = newValue.rawValue }
    }

    init(_ kind: ItemKind, title: String = "", body: String = "", parent: Item? = nil) {
        self.kindRaw = kind.rawValue
        self.title = title
        self.body = body
        self.parent = parent
    }

    var displayTitle: String {
        // Titles never show Markdown symbols.
        let t = MD.plain(title).trimmingCharacters(in: .whitespaces)
        if !t.isEmpty { return t }
        switch kind {
        case .note: return "New Note"
        case .doc: return "Untitled"
        case .lecture: return "Untitled recording"
        }
    }

    /// First line of body text that isn't the title, for list rows.
    var preview: String {
        // Lazy: stop at the first usable line instead of formatting the whole note for every row.
        body.split(whereSeparator: \.isNewline).lazy
            .filter { l in !["```", "|", "![", "---"].contains { l.trimmingCharacters(in: .whitespaces).hasPrefix($0) } }
            .map { MD.plain($0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "#-*>[] "))) }
            .first { !$0.isEmpty && $0 != title } ?? ""
    }

    var audioURL: URL? { audioFile.map { Storage.audio.appending(path: $0) } }

    func touch() { updatedAt = .now }
}

@Model
final class Event {
    var id = UUID()
    var title = ""
    var start = Date()
    var end = Date().addingTimeInterval(3600)
    var allDay = false
    var location: String?
    var notes: String?
    var linkedItemID: UUID?
    /// Same names as the web app: blue, violet, teal, green, amber, rose, slate.
    var color: String = "blue"
    /// Id on linked computers, for events that started there.
    var syncID: String?

    init(title: String, start: Date, end: Date, allDay: Bool = false, location: String? = nil) {
        self.title = title
        self.start = start
        self.end = end
        self.allDay = allDay
        self.location = location
    }

    var agenda: AgendaEvent { AgendaEvent(id: id, title: title, start: start, end: end, allDay: allDay, location: location) }
}

enum Storage {
    nonisolated static let audio: URL = {
        let u = URL.documentsDirectory.appending(path: "Audio", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()

    static let container: ModelContainer = {
        do { return try ModelContainer(for: Item.self, Event.self) }
        catch { fatalError("Couldn't open the database: \(error)") }
    }()

    /// Notes and docs are one thing now: turn any remaining notes into docs (once; cheap when there are none).
    /// Blank docs (no title, no text, no sketch, no sub-docs) are dropped at launch, so a tap on "New doc" never leaves clutter.
    static func dropBlankDocs(_ ctx: ModelContext) {
        let raw = ItemKind.doc.rawValue
        guard let docs = try? ctx.fetch(FetchDescriptor<Item>(predicate: #Predicate { $0.kindRaw == raw && $0.deletedAt == nil })) else { return }
        var changed = false
        for d in docs where d.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && d.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && d.drawing == nil && !d.pinned && (d.children ?? []).isEmpty {
            ctx.delete(d); changed = true
        }
        if changed { try? ctx.save() }
    }

    static func mergeNotesIntoDocs(_ ctx: ModelContext) {
        let raw = ItemKind.note.rawValue
        guard let notes = try? ctx.fetch(FetchDescriptor<Item>(predicate: #Predicate { $0.kindRaw == raw })), !notes.isEmpty else { return }
        for n in notes { n.kindRaw = ItemKind.doc.rawValue }
        try? ctx.save()
    }

    /// Starter content so the first launch isn't empty.
    static func seedIfEmpty(_ ctx: ModelContext) {
        guard (try? ctx.fetchCount(FetchDescriptor<Item>())) == 0 else { return }
        let welcome = Item(.doc, title: "Welcome to Monolith", body: """
        Notes, docs, lectures and your calendar in one place. The assistant runs on this device.

        - [ ] Record a lecture from the Lectures tab
        - [ ] Problem set due Friday at 5pm
        - [ ] Try the watch app: tap record on your wrist
        """)
        welcome.pinned = true
        // Same ids as the web app's starter content, so linking a computer merges them instead of duplicating.
        welcome.syncID = "welcome"
        let doc = Item(.doc, title: "Study system", body: """
        ## Weekly loop

        1. Record lectures, then review the study notes the same day
        2. Turn key points into flashcards
        3. Plan the week in Calendar every Sunday
        """)
        doc.syncID = "doc-guide"
        ctx.insert(welcome)
        ctx.insert(doc)
        let cal = Calendar.current
        let ten = cal.date(bySettingHour: 10, minute: 0, second: 0, of: .now)!
        let lecture = Event(title: "Linear Algebra lecture", start: ten, end: ten.addingTimeInterval(5400), location: "Hall B")
        lecture.syncID = "ev1"
        ctx.insert(lecture)
        let tomorrow = cal.date(byAdding: .day, value: 1, to: cal.date(bySettingHour: 15, minute: 0, second: 0, of: .now)!)!
        let group = Event(title: "Study group", start: tomorrow, end: tomorrow.addingTimeInterval(5400))
        group.syncID = "ev2"
        ctx.insert(group)
    }
}

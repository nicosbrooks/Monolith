import Foundation
import FoundationModels

/// The assistant. Someone picks a model in Settings (or leaves it on Automatic) and it just works:
/// Apple's built-in model where the device has it, otherwise an open model run with MLX.
enum Assistant {
    /// "fast", "default", "enhanced", "apple", or an open model's Hugging Face id (from More models).
    static var choice: String { UserDefaults.standard.string(forKey: "assistantModel") ?? "default" }
    static var appleAvailable: Bool { SystemLanguageModel.default.isAvailable }

    static func openModel(for choice: String) -> OpenModel? {
        guard OpenModels.supported, choice != "apple" else { return nil }
        let model: OpenModel
        switch choice {
        case "fast": model = OpenModels.model(for: .fast)
        case "default", "auto": model = OpenModels.recommended
        case "enhanced": model = OpenModels.model(for: .enhanced)
        default:
            guard let saved = OpenModels.catalog.first(where: { $0.id == choice }) else { return nil }
            model = saved
        }
        return OpenModels.fits(model) ? model : nil
    }

    static var openModelID: String? { openModel(for: choice)?.id }
    static var isAvailable: Bool { choice == "apple" || !OpenModels.supported ? appleAvailable : openModelID != nil }
    static var modelName: String { openModel(for: choice)?.name ?? (isAvailable ? "Apple Intelligence" : "Model unavailable") }

    enum ModelError: LocalizedError {
        case unavailable
        var errorDescription: String? {
            OpenModels.supported ? "Choose a model that this device can run in Settings." : "On-device models need a compatible iPhone or iPad."
        }
    }

    private static let instructions = """
    You are a calm, precise assistant inside a notes app. Use Markdown. Be brief. \
    Use emoji only if the user requests them or they are part of text you need to preserve. \
    Never invent facts that aren't in the provided material.
    """

    /// Answer `prompt` from `context`. Pass `onText` to get the answer so far as it is written.
    static func ask(_ prompt: String, context: String, onText: (@MainActor (String) -> Void)? = nil) async throws -> String {
        // Small on-device models have small context windows, so long material is trimmed.
        let material = String(context.prefix(9000))
        let full = "\(prompt)\n\n---\n\(material)"
        if let id = openModelID {
            return try await OpenModels.shared.respond(model: id, instructions: instructions, prompt: full, onText: onText)
        }
        guard isAvailable else { throw ModelError.unavailable }
        let session = LanguageModelSession(instructions: instructions)
        guard let onText else { return try await session.respond(to: full).content }
        var text = ""
        for try await snapshot in session.streamResponse(to: full) {
            text = snapshot.content
            onText(text)
        }
        return text
    }

    static func studyNotes(for transcript: String) async throws -> String {
        try await ask("""
        Turn this transcript (a class, meeting or conversation) into notes: a one-line summary, then key points \
        as bullets, then any to-dos with dates that were actually mentioned. Use only what is in the transcript.
        """, context: transcript)
    }
}

/// Markdown checklist helpers: `- [ ] task` / `- [x] task`.
enum Tasks {
    static func open(in body: String) -> [String] {
        body.split(whereSeparator: \.isNewline).compactMap { line in
            let t = line.trimmingCharacters(in: .whitespaces)
            return t.hasPrefix("- [ ] ") ? String(t.dropFirst(6)) : nil
        }
    }

    static func check(_ task: String, in body: String) -> String {
        // Only the first match: the same task can appear twice in a note.
        guard let r = body.range(of: "- [ ] \(task)") else { return body }
        return body.replacingCharacters(in: r, with: "- [x] \(task)")
    }
}

/// Dates spotted in your writing ("essay due Nov 14") that aren't on the calendar yet.
struct Suggestion: Identifiable {
    var id: String
    var title: String
    var date: Date
    var source: String
    /// The doc it came from, and the line in it, so the suggestion can say exactly where.
    var itemID: UUID? = nil
    var line: String = ""

    /// Building a detector is slow; one is reused for every scan.
    private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue)

    static func dates(in items: some Sequence<Item>, existing: [Event]) -> [Suggestion] {
        guard let detector else { return [] }
        var out: [Suggestion] = []
        for item in items {
            for raw in item.body.split(whereSeparator: \.isNewline).map(String.init) {
                // Only lines that read like a deadline or appointment, not every mention of a weekday.
                guard raw.range(of: #"\b(due|exam|midterm|final|quiz|test|deadline|submit|essay|paper|presentation|meeting|interview|appointment|office hours)\b"#, options: [.regularExpression, .caseInsensitive]) != nil else { continue }
                // "due Friday" makes the detector return today's date, so blank that word out first.
                let line = MD.plain(raw).replacingOccurrences(of: #"^\s*(- \[[ xX]\] |[-*] |\d+\. |#+ )"#, with: "", options: .regularExpression)
                    .replacingOccurrences(of: #"\s+due\s+"#, with: " — ", options: [.regularExpression, .caseInsensitive])
                let ns = line as NSString
                for m in detector.matches(in: line, range: NSRange(location: 0, length: ns.length)) {
                    guard let date = m.date, date > .now, date < .now.addingTimeInterval(60 * 86400) else { continue }
                    var title = ns.replacingCharacters(in: m.range, with: "")
                        .replacingOccurrences(of: "- [ ]", with: "")
                        .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
                    for w in [" at", " on", " by"] where title.hasSuffix(w) { title = String(title.dropLast(w.count)) }
                    // A whole paragraph isn't an event title.
                    guard title.count > 2, title.count <= 60, !existing.contains(where: { $0.title.localizedCaseInsensitiveCompare(title) == .orderedSame }) else { continue }
                    out.append(Suggestion(id: "\(item.id)-\(title)", title: title, date: date, source: item.displayTitle, itemID: item.id,
                                          line: MD.plain(raw).replacingOccurrences(of: #"^\s*(- \[[ xX]\] |[-*] |\d+\. |#+ )"#, with: "", options: .regularExpression)))
                }
            }
        }
        return out
    }
}

/// "calc review thu 4pm for 2h" → title, start, end
enum QuickAdd {
    static func parse(_ text: String) -> (title: String, start: Date, end: Date)? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue) else { return nil }
        let ns = text as NSString
        guard let m = detector.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)), let start = m.date else { return nil }
        var title = ns.replacingCharacters(in: m.range, with: "")
        var length: TimeInterval = 3600
        if let r = title.range(of: #"for (\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)"#, options: .regularExpression) {
            let parts = title[r].split(separator: " ", maxSplits: 1)
            let n = Double(parts[1].prefix { $0.isNumber || $0 == "." }) ?? 1
            length = parts[1].contains("m") ? n * 60 : n * 3600
            title.removeSubrange(r)
        }
        title = title.trimmingCharacters(in: .whitespaces)
        // "calc review" → "Calc review"
        if let f = title.first { title = f.uppercased() + title.dropFirst() }
        return (title.isEmpty ? "New event" : title, start, start.addingTimeInterval(length))
    }
}

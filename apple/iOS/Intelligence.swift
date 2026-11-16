import Foundation
import FoundationModels
import MLXLMCommon

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
            // A model picked from an older list that's gone now: the Default tier.
            model = OpenModels.catalog.first(where: { $0.id == choice }) ?? OpenModels.recommended
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

    // Small models are only as accurate as what they're given: rules they can follow, and dates spelled out,
    // since they can't do date arithmetic. Mirrors CHAT_RULES in src/ai/context.ts.
    private static let instructions = """
    You are Monolith, a calm, precise study and productivity assistant on the user's own device.
    Rules:
    - Answer from the material given and nothing else. If the answer isn't there, say in one plain, friendly sentence that it isn't in their notes or calendar. Never guess.
    - Use dates and times exactly as listed under Dates and Calendar. Never work out a date yourself.
    - Answer first, then stop: 1–4 sentences or a short list. No preamble, and don't repeat the question.
    - Short Markdown is fine (lists, bold). No tables. No emoji unless asked.
    """

    /// "today: Sunday 2026-11-15", "tomorrow: …", then the next twelve days by name, for the model to look up.
    private static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "EEE yyyy-MM-dd"
        return f
    }()
    /// "Sun 2026-11-15": the same form as the Dates list, so the model can match them up.
    static func day(_ d: Date) -> String { dayFormat.string(from: d) }

    static var dates: String {
        let cal = Calendar.current
        let start = cal.startOfDay(for: .now)
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "EEEE yyyy-MM-dd"
        let name = DateFormatter()
        name.locale = Locale(identifier: "en_US_POSIX")
        name.dateFormat = "EEEE"
        let lines = (0..<14).compactMap { i -> String? in
            guard let d = cal.date(byAdding: .day, value: i, to: start) else { return nil }
            // "Tuesday" means the next one coming, as in quick add; the week after is spelled out.
            let label = i == 0 ? "today, " : i == 1 ? "tomorrow, " : i >= 7 ? "the week after, " : ""
            return "- \(label)\(name.string(from: d)): \(f.string(from: d).split(separator: " ").last ?? "")"
        }
        return "Now: \(Date.now.formatted(date: .complete, time: .shortened))\nDates:\n" + lines.joined(separator: "\n")
    }

    /// Answer `prompt` from `context`. Pass `onText` to get the answer so far as it is written.
    static func ask(_ prompt: String, context: String, onText: (@MainActor (String) -> Void)? = nil) async throws -> String {
        // Small on-device models have small context windows, so long material is trimmed. The question goes last,
        // right before the answer, where small models pay it the most attention.
        let material = String(context.prefix(9000))
        let full = "\(material)\n\n---\nQuestion: \(prompt)"
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

    /// Answer for a linked computer (Linker): its own instructions and conversation, with the model chosen here.
    /// Both are trimmed to what a small on-device window holds, keeping the end, where the question is.
    static func respond(instructions given: String, prompt: String, onText: (@MainActor (String) -> Void)? = nil) async throws -> String {
        let rules = given.isEmpty ? instructions : String(given.prefix(4000))
        let text = prompt.count > 12000 ? String(prompt.suffix(12000)) : prompt
        if let id = openModelID {
            return try await OpenModels.shared.respond(model: id, instructions: rules, prompt: text, onText: onText)
        }
        guard isAvailable else { throw ModelError.unavailable }
        let session = LanguageModelSession(instructions: rules)
        guard let onText else { return try await session.respond(to: text).content }
        var out = ""
        for try await snapshot in session.streamResponse(to: text) {
            try Task.checkCancellation()
            out = snapshot.content
            onText(out)
        }
        return out
    }

    /// Get the chosen model ready while someone is still typing: loads an open model that's already downloaded,
    /// or asks Apple's model to load its weights.
    static func warm() {
        if let id = openModelID { OpenModels.shared.warm(id) }
        else if isAvailable { LanguageModelSession(instructions: instructions).prewarm() }
    }

    /// One chat, one model session. The first question sends the full material; follow-ups send only the
    /// question and anything newly relevant, and the model keeps what it already read, so they start fast.
    final class Conversation {
        private var mlx: ChatSession?
        private var apple: LanguageModelSession?
        /// The model this conversation's material went to (an open model's id, or "apple"). Switching models,
        /// either way, starts over, so the new one gets the dates, calendar and tasks too.
        private var engine: String?
        /// Material already sent in this conversation, so it isn't sent twice.
        private var sent: Set<String> = []
        /// The day the material was written for: the Dates list goes stale at midnight.
        private var day = Calendar.current.startOfDay(for: .now)

        /// `fixed` is the material that only needs sending once (dates, calendar, tasks); `pieces` are
        /// notes and docs, each sent the first time it's relevant.
        func ask(_ prompt: String, fixed: String, pieces: [String], onText: (@MainActor (String) -> Void)? = nil) async throws -> String {
            let today = Calendar.current.startOfDay(for: .now)
            let current = openModelID ?? "apple"
            if today != day || (engine != nil && engine != current) { reset(); day = today }
            engine = current
            let first = sent.isEmpty
            let fresh = pieces.filter { !sent.contains($0) }
            // Small models have small context windows: the first turn is trimmed like a one-off question.
            var material = first ? String(fixed.prefix(5000)) + "\n" : ""
            var budget = first ? 9000 - material.count : 3000
            for p in fresh where budget > 0 {
                let cut = String(p.prefix(budget))
                material += cut + "\n"
                budget -= cut.count
                sent.insert(p)
            }
            if first { sent.insert(fixed) }
            let full = material.isEmpty ? prompt : "\(material)\n---\nQuestion: \(prompt)"
            do {
                if let id = openModelID {
                    if mlx == nil { mlx = try await OpenModels.shared.session(model: id, instructions: instructions) }
                    return try await OpenModels.stream(mlx!, prompt: full, onText: onText)
                }
                guard isAvailable else { throw ModelError.unavailable }
                let session = apple ?? LanguageModelSession(instructions: instructions)
                apple = session
                guard let onText else { return try await session.respond(to: full).content }
                var text = ""
                for try await snapshot in session.streamResponse(to: full) {
                    text = snapshot.content
                    onText(text)
                }
                return text
            } catch {
                // A stopped or failed turn can leave the session mid-answer; start clean next time.
                reset()
                // A long chat can outgrow a small context window: start over with the full material once.
                if !first, !(error is CancellationError), !Task.isCancelled {
                    return try await ask(prompt, fixed: fixed, pieces: pieces, onText: onText)
                }
                throw error
            }
        }

        func reset() { mlx = nil; apple = nil; engine = nil; sent = [] }
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

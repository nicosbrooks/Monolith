import Foundation

/// Quick add: "math 19a homework due tomorrow 9pm" → "Math 19a homework", tomorrow at 9 PM, a deadline.
///
/// A step-for-step port of `parseQuickEvent` in src/lib/dates.ts, so quick add reads the same on every device.
/// Each kind of phrase (date, time, range, length, place) is found, read and cut out of the text with the little
/// words that tie it to the sentence ("on", "at", "by", "from", "due"); what's left is the title. Bare numbers are
/// never times unless something says so, so "Math 19a", "CS 61B" and "Room 4" stay in the title.
/// The cases in scripts/test-dates.ts apply to both; keep the two in step.
enum QuickAdd {
    struct Parsed {
        var title: String
        var start: Date
        var end: Date
        var allDay: Bool
        /// A deadline ("due", "by Friday"), not something that takes up time.
        var due: Bool
        /// "at Chipotle", "@ Room 204".
        var location: String?

        /// The calendar colour: deadlines and exams stand out.
        var color: String {
            due || title.range(of: #"\b(exam|quiz|test|midterm|final|deadline)\b"#, options: [.regularExpression, .caseInsensitive]) != nil ? "rose" : "blue"
        }
    }

    // MARK: Pieces (same as the web)

    private static let weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    private static let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    private static let MONTH = #"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?"#
    private static let ORD = #"(?:st|nd|rd|th)"#
    private static let MER = #"(a\.?m\.?|p\.?m\.?)"#
    private static let LEAD = #"(?:(?:on|at|by|from|starting(?: on| at)?|before|until|till|for|this|next|coming)\s+|@\s*)*"#
    // Full names (and plurals: "mondays"), or the short forms. A short form never takes an "s" ("thus" isn't Thursday), and
    // "sun" counts only before a date, a comma or full stop, or at the end ("watch the sun rise" isn't Sunday).
    private static let WEEKDAY = #"((?:sun|mon|tues|wednes|thurs|fri|satur)day|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat|sun(?=[.,]|\s+\d|\s*$))(?:(?<=day)s)?(?![a-z])"#
    private static let part: [String: Int] = ["morning": 9, "afternoon": 14, "evening": 18, "night": 20, "tonight": 20]

    private struct Clock { var h: Int; var m: Int; var mer: String? }

    private static func mer(_ s: String?) -> String? {
        guard let c = s?.lowercased().first else { return nil }
        return c == "a" ? "am" : "pm"
    }

    private static func hour24(_ c: Clock, _ part: Int?) -> Int {
        var h = c.h
        if c.mer == "pm", h < 12 { h += 12 }
        else if c.mer == "am", h == 12 { h = 0 }
        else if c.mer == nil, h <= 12 {
            if let part { if part >= 12, h < 12 { h += 12 } } // "tonight at 9"
            else if h < 7 { h += 12 } // "at 3" is 3 PM; "at 9" is 9 AM
        }
        return h
    }

    /// A match: its groups (nil when a group didn't take part) and where it was.
    private struct Match {
        let groups: [String?]
        let range: NSRange
        var whole: String { groups[0] ?? "" }
        subscript(_ i: Int) -> String? { i < groups.count ? groups[i] : nil }
    }

    /// The text being read, with phrases cut out of it as they're understood.
    private final class Reader {
        var text: String
        init(_ text: String) { self.text = text }

        func all(_ pattern: String, ci: Bool = true) -> [Match] {
            guard let re = try? NSRegularExpression(pattern: pattern, options: ci ? [.caseInsensitive] : []) else { return [] }
            let ns = text as NSString
            return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { r in
                Match(groups: (0..<r.numberOfRanges).map { i in
                    let g = r.range(at: i)
                    return g.location == NSNotFound ? nil : ns.substring(with: g)
                }, range: r.range)
            }
        }
        func find(_ pattern: String, ci: Bool = true) -> Match? { all(pattern, ci: ci).first }
        func cut(_ m: Match) { text = (text as NSString).replacingCharacters(in: m.range, with: " ") }
        /// Find, cut out and return a phrase.
        func take(_ pattern: String, ci: Bool = true) -> Match? {
            guard let m = find(pattern, ci: ci) else { return nil }
            cut(m)
            return m
        }
        func replace(_ pattern: String, with s: String) {
            guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return }
            text = re.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: s)
        }
    }

    private static func has(_ s: String, _ pattern: String, ci: Bool = true) -> Bool {
        s.range(of: pattern, options: ci ? [.regularExpression, .caseInsensitive] : [.regularExpression]) != nil
    }

    // MARK: Parse

    /// Nil when there's no date or time in the text.
    static func parse(_ input: String, now: Date = .now) -> Parsed? {
        let cal = Calendar.current
        let normalized = input.replacingOccurrences(of: "[’‘]", with: "'", options: .regularExpression)
            .replacingOccurrences(of: "[–—]", with: "-", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        let r = Reader(" \(normalized) ")
        var due = false
        func markDue(_ m: Match?) { if let m, has(m.whole, #"\b(by|before|due)\b"#) { due = true } }
        func num(_ s: String) -> Double {
            switch s.lowercased() { case "a", "an", "one": 1; case "two": 2; case "three": 3; default: Double(s) ?? 1 }
        }

        // "due", "is due", "due on": a deadline. The word itself leaves the title.
        if has(r.text, #"\bdue\b"#) {
            due = true
            r.replace(#"\s(?:is|are)\s+due\b"#, with: " ")
            r.replace(#"\bdue(?:\s+(?:date|on|at|by))?\b"#, with: " ")
        }

        // Length
        var minutes: Double?
        if r.take(#"\s(?:for\s+)?(an?|one)\s+hour\s+and\s+a\s+half\b"#) != nil { minutes = 90 }
        if minutes == nil, r.take(#"\s(?:for\s+)?half\s+an?\s+hour\b"#) != nil { minutes = 30 }
        if minutes == nil, let d = r.take(#"\s(?:for\s+)?(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\s*(\d{1,2})\s*m(?:ins?|inutes?)?\b"#) {
            minutes = num(d[1]!) * 60 + num(d[2]!)
        }
        if minutes == nil, let d = r.take(#"\s(?:for\s+)?(\d+(?:\.\d+)?|an?|one|two|three)\s*(h|hrs?|hours?|m|mins?|minutes?)\b"#) {
            minutes = num(d[1]!) * (d[2]!.lowercased().hasPrefix("h") ? 60 : 1)
        }

        // Day
        let today = cal.startOfDay(for: now)
        let todayIdx = cal.component(.weekday, from: now) - 1
        func addDays(_ d: Date, _ n: Int) -> Date { cal.date(byAdding: .day, value: n, to: d)! }
        func nextDay(_ idx: Int) -> Date { addDays(today, (idx - todayIdx + 7) % 7 == 0 ? 7 : (idx - todayIdx + 7) % 7) }
        let nextWeek = addDays(today, 7 - todayIdx)
        let thisYear = cal.component(.year, from: now)
        func year(_ y: String?) -> Int? { y.flatMap(Int.init).map { $0 < 100 ? 2000 + $0 : $0 } }
        func onDate(_ y: Int?, _ mo: Int, _ dd: Int) -> Date? {
            func make(_ yy: Int) -> Date? {
                guard let x = cal.date(from: DateComponents(year: yy, month: mo + 1, day: dd)), cal.component(.month, from: x) == mo + 1 else { return nil }
                return x
            }
            guard var x = make(y ?? thisYear) else { return nil }
            // Without a year, a date more than a month gone means next year's.
            if y == nil, x < addDays(today, -30), let n = make(thisYear + 1) { x = n }
            return x
        }
        func monthIndex(_ s: String) -> Int { months.firstIndex(of: String(s.lowercased().prefix(3))) ?? 0 }
        func weekdayIndex(_ s: String) -> Int { weekdays.firstIndex { $0.hasPrefix(String(s.lowercased().prefix(3))) } ?? 0 }

        var day: Date?
        var dayPart: Int?
        if let m = r.take(#"\s\#(LEAD)(\d{4})-(\d{1,2})-(\d{1,2})\b"#) {
            markDue(m); day = onDate(Int(m[1]!), Int(m[2]!)! - 1, Int(m[3]!)!)
        } else if let m = r.take(#"\s\#(LEAD)(?:the\s+)?(\d{1,2})\#(ORD)?\s+(?:of\s+)?\#(MONTH)(?:,?\s+(\d{4}))?\b"#) {
            markDue(m); day = onDate(year(m[3]), monthIndex(m[2]!), Int(m[1]!)!)
        } else if let m = r.take(#"\s\#(LEAD)\#(MONTH)\s+(\d{1,2})\#(ORD)?(?:,?\s+(\d{4}))?\b"#) {
            markDue(m); day = onDate(year(m[3]), monthIndex(m[1]!), Int(m[2]!)!)
        } else if let m = r.take(#"\s\#(LEAD)(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b"#) {
            markDue(m)
            // Month first, unless the first number can't be a month.
            let a = Int(m[1]!)!, b = Int(m[2]!)!
            day = a > 12 ? onDate(year(m[3]), b - 1, a) : onDate(year(m[3]), a - 1, b)
        } else if let m = r.take(#"\s\#(LEAD)the\s+(\d{1,2})\#(ORD)\b|\s(?:on|by)\s+(\d{1,2})\#(ORD)\b"#) {
            markDue(m)
            let dd = Int(m[1] ?? m[2]!)!
            // This month's, else next month's; a day the month doesn't have ("the 31st" in November) moves on, never rolls over.
            let first = cal.date(from: cal.dateComponents([.year, .month], from: now))!
            func fit(_ ahead: Int) -> Date? {
                guard let m0 = cal.date(byAdding: .month, value: ahead, to: first),
                      let n = cal.range(of: .day, in: .month, for: m0)?.count, dd >= 1, dd <= n else { return nil }
                return cal.date(byAdding: .day, value: dd - 1, to: m0)
            }
            if let x = fit(0), x >= today { day = x } else if let x = fit(1) ?? fit(2) { day = x }
        } else if let m = r.take(#"\s(?:by\s+|on\s+)?(?:the\s+)?day\s+after\s+(?:tomorrow|tmrw|tmr)\b|\sovermorrow\b"#) {
            markDue(m); day = addDays(today, 2)
        } else if let m = r.take(#"\s(?:by\s+|on\s+|for\s+)?(?:tomorrow|tomorow|tommorow|tommorrow|tmrw|tmr|tmw)(?:\s+(morning|afternoon|evening|night))?\b"#) {
            markDue(m); day = addDays(today, 1)
            if let p = m[1] { dayPart = part[p.lowercased()] }
        } else if let m = r.take(#"\s(?:by\s+)?(?:today|tonight|this\s+(morning|afternoon|evening))\b"#) {
            markDue(m); day = today
            dayPart = has(m.whole, "tonight") ? part["tonight"] : m[1].flatMap { part[$0.lowercased()] }
        } else if let m = r.take(#"\s(?:by\s+)?in\s+(\d+|an?|one|two|three|a\s+couple(?:\s+of)?)\s+(days?|weeks?)\b"#) {
            markDue(m)
            let n = has(m[1]!, "couple") ? 2 : Int(num(m[1]!))
            day = addDays(today, n * (has(m[2]!, "week") ? 7 : 1))
        } else if let m = r.take(#"\s(?:by\s+)?(next|this)\s+weekend\b|\s(?:by\s+|on\s+)?(?:the\s+)?weekend\b"#) {
            markDue(m)
            var d = todayIdx == 6 ? today : nextDay(6)
            if m[1]?.lowercased() == "next" { d = addDays(d, 7) }
            day = d
        } else if let m = r.take(#"\s\#(LEAD)\#(WEEKDAY)\s+(?:of\s+)?next\s+week\b"#) {
            // "friday next week": that weekday in next week (weeks run Sunday to Saturday).
            markDue(m); day = addDays(nextWeek, weekdayIndex(m[1]!))
        } else if let m = r.take(#"\s(?:by\s+)?next\s+week\b"#) {
            markDue(m); day = addDays(nextWeek, 1)
        } else if let m = r.all(#"\s\#(LEAD)\#(WEEKDAY)\b(?:\s+(morning|afternoon|evening|night))?"#).first(where: { !has($0.whole, #"\bSAT\b"#, ci: false) }) {
            // The first weekday that isn't "SAT" (the exam): "SAT prep saturday".
            r.cut(m); markDue(m)
            let idx = weekdayIndex(m[1]!)
            day = has(m.whole, #"\bthis\b"#) && idx == todayIdx ? today : nextDay(idx)
            if let p = m[2] { dayPart = part[p.lowercased()] }
        }
        // "in the morning", "at night". A bare "night" stays: it's often part of the name ("movie night").
        if dayPart == nil, let m = r.take(#"\s(?:in\s+the|this|at|that)\s+(morning|afternoon|evening|night)\b"#) { dayPart = part[m[1]!.lowercased()] }
        // A date already says which day, so a weekday beside it is only a label: "Mon 11/16", "tomorrow (Monday)".
        if day != nil {
            for m in r.all(#"\s\(?(?:on\s+)?\#(WEEKDAY)\)?,?(?=\s)"#).reversed() where !has(m.whole, #"\bSAT\b"#, ci: false) { r.cut(m) }
        }
        // Without am/pm, some plans are clearly evening ones: "dinner at 7:30" is 7:30 PM.
        let hint = dayPart ?? (has(r.text, #"\b(dinner|supper|drinks|party|movie|concert|show|date night|game night|bar|club)\b"#) ? part["evening"] : nil)

        // Time
        var start: Clock?
        var end: Clock?
        let T = #"(\d{1,2})(?:[:.](\d{2}))?\s*\#(MER)?"#
        let RANGE = #"\s\#(LEAD)(?:between\s+)?\#(T)\s*(?:-|to|till|until|and)\s*\#(T)(?=[\s,.!?])"#
        // Only a time range if something says so ("pages 3-5" isn't one, even "tonight": "read chapters 3-5 tonight").
        let counted = { (g: Match) -> Bool in
            g[2] == nil && g[3] == nil && g[5] == nil && g[6] == nil
                && has((r.text as NSString).substring(to: g.range.location + 1), #"\b(?:pages?|pp?|chapters?|ch|sections?|problems?|questions?|exercises?|qs?|slides?|lectures?|units?|modules?|lessons?|weeks?|days?|steps?|items?|parts?|nos?|numbers?|#)\.?\s*$"#)
        }
        if let g = r.find(RANGE), !counted(g), g[3] != nil || g[6] != nil || g[2] != nil || g[5] != nil || dayPart != nil || has(g.whole, #"\b(from|between|at)\b"#),
           Int(g[1]!)! <= 24, Int(g[4]!)! <= 24 {
            r.cut(g); markDue(g)
            var s = Clock(h: Int(g[1]!)!, m: Int(g[2] ?? "0")!, mer: mer(g[3]))
            var e = Clock(h: Int(g[4]!)!, m: Int(g[5] ?? "0")!, mer: mer(g[6]))
            // "3-5pm": the start shares the end's am/pm, unless that would put it after the end ("11-1pm").
            if s.mer == nil, let em = e.mer { s.mer = em == "pm" && s.h > e.h && s.h != 12 ? "am" : em }
            if e.mer == nil, let sm = s.mer { e.mer = sm == "am" && e.h < s.h ? "pm" : sm }
            start = s; end = e
        }
        if start == nil, let m = r.take(#"\s(?:(?:at|by|before|from|starting(?:\s+at)?)\s+)*(noon|midday|midnight|end of (?:the )?day|eod)\b"#) {
            markDue(m)
            let w = m[1]!.lowercased()
            start = w == "midnight" ? Clock(h: 12, m: 0, mer: "am") : has(w, "noon|midday") ? Clock(h: 12, m: 0, mer: "pm") : Clock(h: 5, m: 0, mer: "pm")
            if w == "midnight", let d = day { day = addDays(d, 1) } // "due Friday at midnight" is the end of Friday
        }
        if start == nil, let m = r.take(#"\s\#(LEAD)(\d{1,2})(?:[:.](\d{2}))?\s*\#(MER)(?=[\s,.!?]|$)"#) {
            markDue(m); start = Clock(h: Int(m[1]!)!, m: Int(m[2] ?? "0")!, mer: mer(m[3]))
        }
        if start == nil, let m = r.take(#"\s\#(LEAD)(\d{1,2}):(\d{2})\b"#) {
            markDue(m); start = Clock(h: Int(m[1]!)!, m: Int(m[2]!)!, mer: nil)
        }
        // A bare number only counts after "at"/"by"/"@", or with "o'clock".
        if start == nil, let m = r.take(#"\s(?:(?:at|by|before|@)\s*)(\d{1,2})(?:\s*o'?clock)?(?=[\s,.!?]|$)|\s(\d{1,2})\s*o'?clock\b"#) {
            markDue(m); start = Clock(h: Int(m[1] ?? m[2]!)!, m: 0, mer: nil)
        }
        // "at 9a": single-letter am/pm only after "at", so "19a" or "CS 9a" stay course names.
        if start == nil, let m = r.take(#"\s(?:at|by|@)\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap])(?=[\s,.!?]|$)"#) {
            markDue(m); start = Clock(h: Int(m[1]!)!, m: Int(m[2] ?? "0")!, mer: mer(m[3]))
        }

        func valid(_ c: Clock?) -> Bool { guard let c else { return true }; return c.h <= 24 && c.m < 60 && (c.mer == nil || (1...12).contains(c.h)) }
        guard valid(start), valid(end), day != nil || start != nil else { return nil }

        // Where: "@ Room 204", "at Chipotle" (a capital or number says it's a place), "at the library", "in Room 101".
        // It runs up to a comma or a word that starts a new part ("to study", "with Sam").
        var location: String?
        let placeEnd = #"(?=\s+(?:to|for|with|about|re)\s|\s*[,;]|\s*$)"#
        let place = r.find(#"\s(?:@\s*|[Aa]t\s+(?=[A-Z0-9]))([^,;@]+?)\#(placeEnd)"#, ci: false)
            ?? r.find(#"\sat\s+((?:the\s+)?(?:room|hall|library|lib|cafe|café|coffee shop|office|gym|lab|building|bldg|center|centre|studio|park|school|campus|cafeteria|dining hall)\b[^,;@]*?)\#(placeEnd)"#)
            ?? r.find(#"\sin\s+((?:the\s+)?(?:room|rm|hall|building|bldg|lab|library|auditorium|lecture hall|gym)\b[^,;@]*?)\#(placeEnd)"#)
        if let p = place, let w = p[1], has(w, "[a-z]") {
            location = w.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: #"[.!?]+$"#, with: "", options: .regularExpression)
            r.cut(p)
        }

        // Title
        let edge = #"^(?:on|at|by|from|to|until|till|for|this|next|the|in|is|are|was|be|will|starting|and|@|[-–—,:;.()]+)$"#
        var words = r.text.replacingOccurrences(of: #"\s+([,.!?;:])"#, with: "$1", options: .regularExpression)
            .split(separator: " ").map(String.init).filter { !$0.isEmpty }
        while let last = words.last, has(last.replacingOccurrences(of: #"[,.!?;:]+$"#, with: "", options: .regularExpression), edge) { words.removeLast() }
        while let first = words.first, has(first, edge) { words.removeFirst() }
        var title = words.joined(separator: " ").replacingOccurrences(of: #"[,;:\s]+$"#, with: "", options: .regularExpression)
        if title.isEmpty { title = due ? "Deadline" : "New event" }
        else { title = title.prefix(1).uppercased() + title.dropFirst() }

        // When
        func at(_ d: Date, _ h: Int, _ m: Int) -> Date { cal.date(bySettingHour: h % 24, minute: m, second: 0, of: d)! }
        let s: Date
        let e: Date
        if let st = start {
            let h = hour24(st, hint)
            var x = at(day ?? today, h, st.m)
            if h == 24 { x = addDays(x, 1) }
            // A time with no day that's already gone today means tomorrow.
            if day == nil, x < now { x = addDays(x, 1) }
            s = x
            if let en = end {
                var y = at(x, hour24(en, hint), en.m)
                if y <= x { y = addDays(y, 1) }
                e = y
            } else {
                e = x.addingTimeInterval((minutes ?? (due ? 30 : 60)) * 60)
            }
        } else if let p = dayPart {
            var x = at(day ?? today, p, 0)
            if day == nil, x < now { x = addDays(x, 1) }
            s = x
            e = x.addingTimeInterval((minutes ?? 60) * 60)
        } else {
            s = day!
            e = addDays(s, 1)
        }
        return Parsed(title: title, start: s, end: e, allDay: start == nil && dayPart == nil, due: due, location: location)
    }
}

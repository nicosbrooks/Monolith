import SwiftUI

/// Inline formatting on a stretch of text. This is what's stored and synced (as Markdown); the fonts and colours
/// people see are worked out from it.
nonisolated struct Marks: OptionSet, Hashable, Sendable, Codable {
    let rawValue: Int
    static let bold = Marks(rawValue: 1)
    static let italic = Marks(rawValue: 2)
    static let code = Marks(rawValue: 4)
    static let strike = Marks(rawValue: 8)
    static let highlight = Marks(rawValue: 16)
}

nonisolated enum MarksAttribute: CodableAttributedStringKey {
    typealias Value = Marks
    static let name = "socratic.marks"
}

nonisolated extension AttributeScopes {
    /// SwiftUI's text attributes plus our formatting marks, so the text editor keeps the marks as people type.
    struct MonolithAttributes: AttributeScope {
        let marks: MarksAttribute
        let swiftUI: SwiftUIAttributes
    }

    var monolith: MonolithAttributes.Type { MonolithAttributes.self }
}

nonisolated extension AttributeDynamicLookup {
    subscript<T: AttributedStringKey>(dynamicMember keyPath: KeyPath<AttributeScopes.MonolithAttributes, T>) -> T { self[T.self] }
}

/// Formatted text to Markdown and back. People only ever see the formatted side.
nonisolated enum Rich {
    // The system Markdown parser has no highlights, and drops bold and italic inside link text. So highlights and
    // links are swapped for these private marker characters first, and turned into formatting afterwards.
    private static let hlOpen: Character = "\u{E000}", hlClose: Character = "\u{E001}"
    private static let linkOpen: Character = "\u{E002}", linkClose: Character = "\u{E003}"
    private static let linkPattern = try! NSRegularExpression(pattern: #"(?<![\\!])\[((?:[^\[\]\\]|\\.)+?)\]\((<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)\)"#)

    // MARK: Markdown → formatted text

    /// One line of inline Markdown as text carrying marks and links. Not styled yet; see `styled`.
    static func parse(_ md: String) -> AttributedString {
        // The web editor writes highlights as ==text== (or <mark> in older notes).
        var src = md.replacingOccurrences(of: #"<mark[^>]*>(.*?)</mark>"#, with: "==$1==", options: .regularExpression)
        src = src.replacingOccurrences(of: #"(?<!\\)==(?=\S)(.+?)(?<=\S)(?<!\\)=="#, with: "\(hlOpen)$1\(hlClose)", options: .regularExpression)
        var urls: [URL?] = []
        let ns = src as NSString
        var swapped = ""
        var at = 0
        for m in linkPattern.matches(in: src, range: NSRange(location: 0, length: ns.length)) {
            var address = ns.substring(with: m.range(at: 2))
            if address.hasPrefix("<") { address = String(address.dropFirst().dropLast()) }
            urls.append(URL(string: address) ?? address.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed).flatMap(URL.init(string:)))
            swapped += ns.substring(with: NSRange(location: at, length: m.range.location - at))
            swapped += "\(linkOpen)\(ns.substring(with: m.range(at: 1)))\(linkClose)"
            at = m.range.location + m.range.length
        }
        swapped += ns.substring(from: at)

        guard let parsed = try? AttributedString(markdown: swapped, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else {
            return AttributedString(md)
        }
        var out = AttributedString()
        var highlighted = false
        var link: URL?
        var nextLink = 0
        for run in parsed.runs {
            var marks: Marks = []
            if let intent = run.inlinePresentationIntent {
                if intent.contains(.stronglyEmphasized) { marks.insert(.bold) }
                if intent.contains(.emphasized) { marks.insert(.italic) }
                if intent.contains(.code) { marks.insert(.code) }
                if intent.contains(.strikethrough) { marks.insert(.strike) }
            }
            var text = ""
            func flush() {
                guard !text.isEmpty else { return }
                var piece = AttributedString(text)
                let all = highlighted ? marks.union(.highlight) : marks
                if !all.isEmpty { piece.marks = all }
                if let l = link ?? run.link { piece.link = l }
                out += piece
                text = ""
            }
            for c in parsed[run.range].characters {
                switch c {
                case hlOpen: flush(); highlighted = true
                case hlClose: flush(); highlighted = false
                case linkOpen: flush(); link = nextLink < urls.count ? urls[nextLink] : nil; nextLink += 1
                case linkClose: flush(); link = nil
                default: text.append(c)
                }
            }
            flush()
        }
        return out
    }

    /// The text with no formatting, for list previews and search.
    static func plain(_ md: String) -> String {
        // Most titles and lines have no inline Markdown at all; skip the parser for those.
        if !md.contains(where: { "*_`~[]<>=\\&".contains($0) }) { return md }
        return String(parse(md).characters)
    }

    // MARK: Formatted text → Markdown

    private enum Token: Equatable {
        case link(URL), highlight, strike, bold, italic, code

        var open: String {
            switch self {
            case .link: "["
            case .highlight: "=="
            case .strike: "~~"
            case .bold: "**"
            case .italic: "*"
            case .code: "`"
            }
        }

        var close: String {
            if case .link(let url) = self {
                let s = url.absoluteString
                return s.contains(where: { " ()".contains($0) }) ? "](<\(s)>)" : "](\(s))"
            }
            return open
        }
    }

    private struct Piece {
        var text: String
        var marks: Marks
        var link: URL?
        var space: Bool

        /// Outermost first. Links wrap everything; code sits innermost, because nothing inside it is formatted.
        var tokens: [Token] {
            var t: [Token] = []
            if let link { t.append(.link(link)) }
            if marks.contains(.highlight) { t.append(.highlight) }
            if marks.contains(.strike) { t.append(.strike) }
            if marks.contains(.bold) { t.append(.bold) }
            if marks.contains(.italic) { t.append(.italic) }
            if marks.contains(.code) { t.append(.code) }
            return t
        }
    }

    static func markdown(_ text: AttributedString) -> String {
        // Markdown won't take a space just inside a marker ("**bold **"), so spaces at the edges of a run are
        // handled on their own: they keep only the formatting that both neighbours share.
        var pieces: [Piece] = []
        for run in text.runs {
            let s = String(text[run.range].characters).replacingOccurrences(of: "\n", with: " ")
            let marks = run.marks ?? []
            let link = run.link
            if marks.contains(.code) {
                pieces.append(Piece(text: s, marks: marks, link: link, space: false))
                continue
            }
            let lead = s.prefix { $0 == " " }
            let rest = s.dropFirst(lead.count)
            let trail = rest.reversed().prefix { $0 == " " }
            let core = rest.dropLast(trail.count)
            if !lead.isEmpty { pieces.append(Piece(text: String(lead), marks: marks, link: link, space: true)) }
            if !core.isEmpty { pieces.append(Piece(text: String(core), marks: marks, link: link, space: false)) }
            if !trail.isEmpty { pieces.append(Piece(text: String(trail), marks: marks, link: link, space: true)) }
        }
        for i in pieces.indices where pieces[i].space {
            let before = pieces[..<i].last { !$0.space }
            let after = pieces[(i + 1)...].first { !$0.space }
            pieces[i].marks = (before?.marks ?? []).intersection(after?.marks ?? [])
            pieces[i].link = before?.link != nil && before?.link == after?.link ? before?.link : nil
        }

        var out = ""
        var open: [Token] = []
        for p in pieces {
            let want = p.tokens
            // Close what this piece doesn't have, and anything opened inside it. Code can't hold other formatting,
            // so it never stays open from one piece to the next.
            let cut = open.firstIndex { !want.contains($0) || $0 == .code } ?? open.count
            for t in open[cut...].reversed() { out += t.close }
            open.removeSubrange(cut...)
            for t in want where !open.contains(t) {
                out += t.open
                open.append(t)
            }
            out += p.marks.contains(.code) ? p.text.replacingOccurrences(of: "`", with: "'") : escape(p.text)
        }
        for t in open.reversed() { out += t.close }
        return out
    }

    /// Characters that would otherwise be read as formatting.
    private static func escape(_ s: String) -> String {
        var out = ""
        for c in s {
            if "\\*_`[]".contains(c) { out.append("\\") }
            out.append(c)
        }
        return out.replacingOccurrences(of: "==", with: "\\=\\=").replacingOccurrences(of: "~~", with: "\\~\\~")
    }

    // MARK: What people see

    static let highlightColor = Color.yellow.opacity(0.35)
    static let codeColor = Color.secondary.opacity(0.14)

    static func font(_ marks: Marks, base: Font) -> Font? {
        guard !marks.intersection([.bold, .italic, .code]).isEmpty else { return nil }
        var f = marks.contains(.code) ? base.monospaced() : base
        if marks.contains(.bold) { f = f.bold() }
        if marks.contains(.italic) { f = f.italic() }
        return f
    }

    static func background(_ marks: Marks) -> Color? {
        marks.contains(.code) ? codeColor : marks.contains(.highlight) ? highlightColor : nil
    }

    /// Works out fonts and colours from the marks. `base` is the line's own font (body, or a heading).
    static func style(_ text: inout AttributedString, base: Font, done: Bool = false) {
        for run in text.runs {
            let marks = run.marks ?? []
            let font = font(marks, base: base)
            let background = background(marks)
            let strike: Text.LineStyle? = marks.contains(.strike) || done ? .single : nil
            let underline: Text.LineStyle? = run.link != nil ? .single : nil
            // Only touch what's different, so an already-styled line compares equal and nothing redraws.
            if run.font != font { text[run.range].font = font }
            if run.backgroundColor != background { text[run.range].backgroundColor = background }
            if run.strikethroughStyle != strike { text[run.range].strikethroughStyle = strike }
            if run.underlineStyle != underline { text[run.range].underlineStyle = underline }
        }
    }

    /// Inline Markdown ready to show in a `Text`.
    static func styled(_ md: String, base: Font = .body) -> AttributedString {
        var a = parse(md)
        style(&a, base: base)
        return a
    }
}

// MARK: - Rules the text editor follows

/// Tells the text editor that looks come from marks: whatever is typed, pasted or chosen from the system's own
/// Format menu, bold text is bold because it's marked bold, and nothing else.
nonisolated struct RichFormat: AttributedTextFormattingDefinition {
    typealias Scope = AttributeScopes.MonolithAttributes
    var base: Font
    var done = false

    var body: some AttributedTextFormattingDefinition<Scope> {
        FontRule(base: base)
        BackgroundRule()
        StrikeRule(done: done)
        UnderlineRule()
    }
}

nonisolated struct FontRule: AttributedTextValueConstraint {
    typealias Scope = AttributeScopes.MonolithAttributes
    typealias AttributeKey = AttributeScopes.SwiftUIAttributes.FontAttribute
    var base: Font
    func constrain(_ c: inout Attributes) { c.font = Rich.font(c.marks ?? [], base: base) }
}

nonisolated struct BackgroundRule: AttributedTextValueConstraint {
    typealias Scope = AttributeScopes.MonolithAttributes
    typealias AttributeKey = AttributeScopes.SwiftUIAttributes.BackgroundColorAttribute
    func constrain(_ c: inout Attributes) { c.backgroundColor = Rich.background(c.marks ?? []) }
}

nonisolated struct StrikeRule: AttributedTextValueConstraint {
    typealias Scope = AttributeScopes.MonolithAttributes
    typealias AttributeKey = AttributeScopes.SwiftUIAttributes.StrikethroughStyleAttribute
    var done: Bool
    func constrain(_ c: inout Attributes) { c.strikethroughStyle = (c.marks ?? []).contains(.strike) || done ? .single : nil }
}

nonisolated struct UnderlineRule: AttributedTextValueConstraint {
    typealias Scope = AttributeScopes.MonolithAttributes
    typealias AttributeKey = AttributeScopes.SwiftUIAttributes.UnderlineStyleAttribute
    func constrain(_ c: inout Attributes) { c.underlineStyle = c.link != nil ? .single : nil }
}

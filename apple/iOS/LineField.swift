import SwiftUI
import UIKit

/// One line of a note, edited in a plain UIKit text view. SwiftUI's own rich text editor drops keystrokes and
/// moves the cursor when the text is changed under it, which a notes editor does all the time (a list shortcut,
/// Return, Delete at the start). Here those are handled before the text changes, so nothing races.
struct LineField: UIViewRepresentable {
    enum Mode { case rich, code }

    var id: UUID
    @Binding var text: AttributedString
    var kind: Block.Kind
    var mode: Mode = .rich
    @Binding var focus: UUID?
    var lines: Lines
    var events: LineEvents

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> LineTextView {
        let v = LineTextView()
        v.delegate = context.coordinator
        v.isScrollEnabled = false
        v.backgroundColor = .clear
        v.textContainerInset = .zero
        v.textContainer.lineFragmentPadding = 0
        v.adjustsFontForContentSizeCategory = true
        v.linkTextAttributes = [.foregroundColor: UIColor.label, .underlineStyle: NSUnderlineStyle.single.rawValue]
        v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        if mode == .code {
            v.autocapitalizationType = .none
            v.autocorrectionType = .no
            v.smartQuotesType = .no
            v.smartDashesType = .no
        }
        v.inputAccessoryView = context.coordinator.toolbar()
        let c = context.coordinator
        v.onDeleteAtStart = { [weak c] in
            guard let c else { return }
            c.parent.events.deleteAtStart(c.parent.id)
        }
        c.show(text, in: v)
        lines.views[id] = v
        return v
    }

    func updateUIView(_ v: LineTextView, context: Context) {
        let c = context.coordinator
        c.parent = self
        lines.views[id] = v
        if LineText.key(text) != c.shown || kind != c.kind {
            c.show(text, in: v)
        }
        c.enableIndents()
        if focus == id {
            if v.isFirstResponder {
                c.placeCursor(v)
            } else {
                DispatchQueue.main.async {
                    guard c.parent.focus == c.parent.id, !v.isFirstResponder, v.window != nil else { return }
                    v.becomeFirstResponder()
                    c.placeCursor(v)
                }
            }
        }
    }

    static func dismantleUIView(_ v: LineTextView, coordinator: Coordinator) {
        let p = coordinator.parent
        if p.lines.views[p.id] === v { p.lines.views[p.id] = nil }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView v: LineTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? UIScreen.main.bounds.width
        let fit = v.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: max(fit.height, LineText.font(kind, [], mode: mode).lineHeight))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: LineField
        /// What the text view was last given or last reported, so an update that changes nothing isn't re-applied.
        var shown: [LineText.Run] = []
        var kind: Block.Kind

        init(_ parent: LineField) {
            self.parent = parent
            self.kind = parent.kind
        }

        /// Puts new text in the view, keeping the cursor where it was.
        func show(_ text: AttributedString, in v: LineTextView) {
            kind = parent.kind
            shown = LineText.key(text)
            let sel = v.selectedRange
            let typing = Marks(rawValue: v.typingAttributes[.marks] as? Int ?? 0)
            v.attributedText = LineText.ns(text, kind: kind, mode: parent.mode)
            let length = (v.text as NSString).length
            v.selectedRange = NSRange(location: min(sel.location, length), length: 0)
            if length == 0 || sel.location == 0 { v.typingAttributes = LineText.attributes(length == 0 ? typing : [], link: nil, kind: kind, mode: parent.mode) }
        }

        /// Where the editor asked the cursor to go (after Return, joining two lines, and so on).
        func placeCursor(_ v: LineTextView) {
            guard let at = parent.lines.cursor.removeValue(forKey: parent.id) else { return }
            v.selectedRange = NSRange(location: LineText.utf16(v.text, at), length: 0)
            if at == 0 { v.typingAttributes = LineText.attributes([], link: nil, kind: kind, mode: parent.mode) }
        }

        func textViewDidBeginEditing(_ v: UITextView) {
            if parent.focus != parent.id { parent.focus = parent.id }
            if let v = v as? LineTextView { placeCursor(v) }
        }

        func textViewDidEndEditing(_ v: UITextView) {
            if parent.focus == parent.id { parent.focus = nil }
        }

        func textView(_ v: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            // Return (or pasting several lines) splits the line, which the editor does. The text view never holds a
            // line break.
            guard parent.mode == .rich, text.contains(where: \.isNewline) else { return true }
            let next = NSMutableAttributedString(attributedString: v.attributedText)
            let insert = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            next.replaceCharacters(in: range, with: NSAttributedString(string: insert, attributes: v.typingAttributes))
            let cursor = LineText.characters(next.string, range.location + (insert as NSString).length)
            parent.events.split(parent.id, LineText.attributed(next), cursor)
            return false
        }

        func textViewDidChange(_ v: UITextView) {
            guard let v = v as? LineTextView else { return }
            // While a word is being composed (Japanese, Chinese, dictation), leave the text alone.
            if parent.mode == .rich, v.markedTextRange == nil {
                switch parent.events.shortcut(parent.id, v.text) {
                case .replaced:
                    return
                case .strip(let n):
                    let sel = v.selectedRange
                    v.textStorage.deleteCharacters(in: NSRange(location: 0, length: LineText.utf16(v.text, n)))
                    kind = parent.events.kind(parent.id) ?? kind
                    restyle(v)
                    v.selectedRange = NSRange(location: max(0, sel.location - n), length: 0)
                case .none:
                    break
                }
                let content = LineText.attributed(v.attributedText)
                let cursor = LineText.characters(v.text, v.selectedRange.location)
                if let (out, at, typing) = Rich.inlineShortcut(content, cursor: cursor) {
                    v.attributedText = LineText.ns(out, kind: kind, mode: parent.mode)
                    v.selectedRange = NSRange(location: LineText.utf16(v.text, at), length: 0)
                    if let typing { v.typingAttributes = LineText.attributes(typing, link: nil, kind: kind, mode: parent.mode) }
                }
            }
            report(v)
        }

        /// Hands the text to the editor.
        func report(_ v: UITextView) {
            let content = LineText.attributed(v.attributedText)
            shown = LineText.key(content)
            parent.text = content
        }

        /// Fonts and colours from the marks, after a change of kind or formatting.
        func restyle(_ v: UITextView) {
            let sel = v.selectedRange
            let typing = Marks(rawValue: v.typingAttributes[.marks] as? Int ?? 0)
            v.attributedText = LineText.ns(LineText.attributed(v.attributedText), kind: kind, mode: parent.mode)
            v.selectedRange = sel
            // What's typed next takes the new look too (a heading's size, a done item's strikethrough).
            v.typingAttributes = LineText.attributes(typing, link: nil, kind: kind, mode: parent.mode)
        }

        // MARK: Toolbar

        /// Indent and Outdent, enabled only on list items (the only lines that nest).
        private var indents: [UIBarButtonItem] = []
        func enableIndents() {
            let list: Bool = switch parent.kind { case .bullet, .numbered, .todo: true; default: false }
            indents.forEach { $0.isEnabled = list }
        }

        func toolbar() -> UIToolbar {
            let bar = UIToolbar(frame: CGRect(x: 0, y: 0, width: 320, height: 44))
            func item(_ symbol: String, _ label: String, _ run: @escaping () -> Void) -> UIBarButtonItem {
                let b = UIBarButtonItem(image: UIImage(systemName: symbol), primaryAction: UIAction { _ in run() })
                b.accessibilityLabel = label
                return b
            }
            let format = UIBarButtonItem(image: UIImage(systemName: "textformat"), menu: UIMenu(children: [
                UIDeferredMenuElement.uncached { [weak self] done in done(self?.parent.events.menu() ?? []) },
            ]))
            format.accessibilityLabel = "Format"
            let out = item("decrease.indent", "Outdent") { [weak self] in self?.parent.events.indent(-1) }
            let into = item("increase.indent", "Indent") { [weak self] in self?.parent.events.indent(1) }
            indents = [out, into]
            bar.items = [
                item("checklist", "Checklist") { [weak self] in self?.parent.events.checklist() },
                item("list.bullet", "Bulleted list") { [weak self] in self?.parent.events.bullets() },
                format,
                .flexibleSpace(),
                out,
                into,
                item("keyboard.chevron.compact.down", "Hide keyboard") { [weak self] in self?.parent.events.hide() },
            ]
            enableIndents()
            bar.sizeToFit()
            return bar
        }
    }
}

/// What a line hands back to the editor.
struct LineEvents {
    enum Shortcut { case none, strip(Int), replaced }

    var split: (UUID, AttributedString, Int) -> Void
    var deleteAtStart: (UUID) -> Void
    /// Called with the line's words after each edit: a Markdown shortcut at the start becomes what it means.
    var shortcut: (UUID, String) -> Shortcut
    var kind: (UUID) -> Block.Kind?
    var checklist: () -> Void
    var bullets: () -> Void
    var menu: () -> [UIMenuElement]
    var hide: () -> Void
    var bold: () -> Void
    var indent: (Int) -> Void
}

/// The text views on screen, so the toolbar can act on the one being edited, and where the cursor should go next.
final class Lines {
    var views: [UUID: LineTextView] = [:]
    var cursor: [UUID: Int] = [:]
}

final class LineTextView: UITextView {
    var onDeleteAtStart: (() -> Void)?

    override func deleteBackward() {
        if selectedRange == NSRange(location: 0, length: 0), markedTextRange == nil {
            onDeleteAtStart?()
            return
        }
        super.deleteBackward()
    }

    private var coordinator: LineField.Coordinator? { delegate as? LineField.Coordinator }

    /// Bold, italic and so on, for the selected words or for what's typed next.
    func toggle(_ m: Marks) {
        guard let c = coordinator else { return }
        let r = selectedRange
        if r.length == 0 {
            var marks = Marks(rawValue: typingAttributes[.marks] as? Int ?? 0)
            if marks.contains(m) { marks.remove(m) } else { marks.insert(m) }
            typingAttributes = LineText.attributes(marks, link: typingAttributes[.link] as? URL, kind: c.kind, mode: c.parent.mode)
            return
        }
        var all = true
        textStorage.enumerateAttribute(.marks, in: r) { value, _, _ in
            if !Marks(rawValue: value as? Int ?? 0).contains(m) { all = false }
        }
        textStorage.enumerateAttributes(in: r) { attrs, range, _ in
            var marks = Marks(rawValue: attrs[.marks] as? Int ?? 0)
            if all { marks.remove(m) } else { marks.insert(m) }
            textStorage.setAttributes(LineText.attributes(marks, link: attrs[.link] as? URL, kind: c.kind, mode: c.parent.mode), range: range)
        }
        selectedRange = r
        c.report(self)
    }

    var hasLink: Bool {
        let r = selectedRange
        if r.length > 0 { return textStorage.attribute(.link, at: r.location, effectiveRange: nil) != nil }
        return typingAttributes[.link] != nil
    }

    /// Links the selected words. With nothing selected, the address itself is put in as the linked words.
    /// `nil` takes the link off the selection, or off the whole link the cursor is in.
    func setLink(_ url: URL?) {
        guard let c = coordinator else { return }
        var r = selectedRange
        if let url, r.length == 0 {
            let words = NSAttributedString(string: url.absoluteString, attributes: LineText.attributes([], link: url, kind: c.kind, mode: c.parent.mode))
            textStorage.replaceCharacters(in: r, with: words)
            selectedRange = NSRange(location: r.location + words.length, length: 0)
            typingAttributes = LineText.attributes([], link: nil, kind: c.kind, mode: c.parent.mode)
            c.report(self)
            return
        }
        if url == nil, r.length == 0 {
            let at = max(0, r.location - 1)
            guard at < textStorage.length else { return }
            var whole = NSRange()
            guard textStorage.attribute(.link, at: at, longestEffectiveRange: &whole, in: NSRange(location: 0, length: textStorage.length)) != nil else { return }
            r = whole
        }
        if let url { textStorage.addAttribute(.link, value: url, range: r) } else { textStorage.removeAttribute(.link, range: r) }
        textStorage.enumerateAttributes(in: r) { attrs, range, _ in
            textStorage.setAttributes(LineText.attributes(Marks(rawValue: attrs[.marks] as? Int ?? 0), link: attrs[.link] as? URL, kind: c.kind, mode: c.parent.mode), range: range)
        }
        typingAttributes[.link] = nil
        c.report(self)
    }
}

extension NSAttributedString.Key {
    /// Our formatting marks (`Marks.rawValue`), carried in the text view so they survive typing and pasting.
    static let marks = NSAttributedString.Key("socratic.marks")
}

/// Formatted words to the text view's attributed text and back.
enum LineText {
    struct Run: Equatable { var text: String; var marks: Int; var link: URL? }

    /// The text and its formatting, ignoring how it's drawn. Two lines with the same key show the same thing.
    static func key(_ s: AttributedString) -> [Run] {
        s.runs.map { Run(text: String(s[$0.range].characters), marks: ($0.marks ?? []).rawValue, link: $0.link) }
    }

    static func font(_ kind: Block.Kind, _ marks: Marks, mode: LineField.Mode = .rich) -> UIFont {
        if mode == .code {
            return UIFont.monospacedSystemFont(ofSize: UIFont.preferredFont(forTextStyle: .callout).pointSize, weight: .regular)
        }
        let (style, weight): (UIFont.TextStyle, UIFont.Weight) = switch kind {
        case .h1: (.title2, .bold)
        case .h2: (.title3, .semibold)
        case .h3: (.headline, .semibold)
        default: (.body, .regular)
        }
        let size = UIFont.preferredFont(forTextStyle: style).pointSize
        let w: UIFont.Weight = marks.contains(.bold) ? .bold : weight
        var f = marks.contains(.code) ? UIFont.monospacedSystemFont(ofSize: size * 0.92, weight: w) : UIFont.systemFont(ofSize: size, weight: w)
        if marks.contains(.italic), let d = f.fontDescriptor.withSymbolicTraits(f.fontDescriptor.symbolicTraits.union(.traitItalic)) {
            f = UIFont(descriptor: d, size: f.pointSize)
        }
        return f
    }

    static func attributes(_ marks: Marks, link: URL?, kind: Block.Kind, mode: LineField.Mode) -> [NSAttributedString.Key: Any] {
        let done = kind == .todo(true)
        var a: [NSAttributedString.Key: Any] = [
            .font: font(kind, marks, mode: mode),
            .foregroundColor: done || kind == .quote ? UIColor.secondaryLabel : UIColor.label,
        ]
        guard mode == .rich else { return a }
        if !marks.isEmpty { a[.marks] = marks.rawValue }
        if let link { a[.link] = link }
        if marks.contains(.code) {
            a[.backgroundColor] = UIColor.label.withAlphaComponent(0.07)
        } else if marks.contains(.highlight) {
            a[.backgroundColor] = UIColor.systemYellow.withAlphaComponent(0.35)
        }
        if marks.contains(.strike) || done { a[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        return a
    }

    static func ns(_ s: AttributedString, kind: Block.Kind, mode: LineField.Mode) -> NSAttributedString {
        let out = NSMutableAttributedString()
        for run in s.runs {
            out.append(NSAttributedString(string: String(s[run.range].characters),
                                          attributes: attributes(run.marks ?? [], link: run.link, kind: kind, mode: mode)))
        }
        return out
    }

    static func attributed(_ ns: NSAttributedString) -> AttributedString {
        var out = AttributedString()
        ns.enumerateAttributes(in: NSRange(location: 0, length: ns.length)) { attrs, range, _ in
            var piece = AttributedString(ns.attributedSubstring(from: range).string)
            if let raw = attrs[.marks] as? Int, raw != 0 { piece.marks = Marks(rawValue: raw) }
            if let url = attrs[.link] as? URL {
                piece.link = url
            } else if let s = attrs[.link] as? String, let url = URL(string: s) {
                piece.link = url
            }
            out += piece
        }
        return out
    }

    /// UTF-16 offset (what the text view counts) of the character offset `n`.
    static func utf16(_ s: String, _ n: Int) -> Int {
        let i = s.index(s.startIndex, offsetBy: min(max(0, n), s.count))
        return s.utf16.distance(from: s.utf16.startIndex, to: i)
    }

    /// Character offset of the UTF-16 offset `u`.
    static func characters(_ s: String, _ u: Int) -> Int {
        let i = s.utf16.index(s.utf16.startIndex, offsetBy: min(max(0, u), s.utf16.count))
        return s.distance(from: s.startIndex, to: String.Index(i, within: s) ?? s.endIndex)
    }
}

extension Rich {
    private static let inlineRules: [(NSRegularExpression, Marks?)] = [
        (#"\*\*([^\s*](?:[^*]*[^\s*])?)\*\*"#, Marks.bold),
        (#"(?<![*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?!\*)"#, Marks.italic),
        (#"(?<![\w])_([^\s_](?:[^_]*[^\s_])?)_(?![\w])"#, Marks.italic),
        (#"`([^`]+)`"#, Marks.code),
        (#"~~([^\s~](?:[^~]*[^\s~])?)~~"#, Marks.strike),
        (#"==([^\s=](?:[^=]*[^\s=])?)=="#, Marks.highlight),
        (#"\[([^\[\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)"#, nil), // a link
    ].map { (try! NSRegularExpression(pattern: $0.0), $0.1) }

    /// "**bold**", "`code`", "[text](address)" typed out by hand become the formatting they describe. Returns the
    /// new text, where the cursor goes, and the formatting to keep typing in when the cursor is right after it.
    static func inlineShortcut(_ rich: AttributedString, cursor: Int) -> (AttributedString, Int, Marks?)? {
        let plain = String(rich.characters)
        guard plain.contains(where: { "*_`~=)".contains($0) }) else { return nil }
        for (rule, mark) in inlineRules {
            guard let m = rule.firstMatch(in: plain, range: NSRange(plain.startIndex..., in: plain)),
                  let whole = Range(m.range, in: plain), let inner = Range(m.range(at: 1), in: plain) else { continue }
            func offset(_ s: String.Index) -> Int { plain.distance(from: plain.startIndex, to: s) }
            func index(_ s: String.Index) -> AttributedString.Index { rich.index(rich.startIndex, offsetByCharacters: offset(s)) }
            let range = index(whole.lowerBound)..<index(whole.upperBound)
            // Symbols inside code are just code.
            if rich[range].runs.contains(where: { ($0.marks ?? []).contains(.code) }) { continue }
            var words = AttributedString(rich[index(inner.lowerBound)..<index(inner.upperBound)])
            if let mark {
                for run in words.runs { words[run.range].marks = (run.marks ?? []).union(mark) }
            } else if let r = Range(m.range(at: 2), in: plain), let url = URL(string: String(plain[r])) {
                words.link = url
            } else {
                continue
            }
            let before: Marks = range.lowerBound > rich.startIndex ? rich.runs[rich.index(beforeCharacter: range.lowerBound)].marks ?? [] : []
            var out = rich
            out.replaceSubrange(range, with: words)
            let start = offset(whole.lowerBound), end = offset(whole.upperBound)
            let newEnd = start + words.characters.count
            let at: Int
            if cursor >= end { at = cursor - (end - start - words.characters.count) }
            else if cursor <= start { at = cursor }
            else { at = newEnd }
            return (out, at, at == newEnd ? before : nil)
        }
        return nil
    }
}

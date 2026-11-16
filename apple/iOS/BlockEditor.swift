import SwiftUI

/// One block of a note or doc: a paragraph, a list item, a heading, a table. Stored as Markdown, edited as
/// formatted text. People never see the Markdown.
struct Block: Identifiable, Equatable {
    enum Kind: Equatable { case text, h1, h2, h3, bullet, numbered, todo(Bool), quote, code(String), divider, table, image }

    /// An invisible character at the start of every line. Deleting it is how we know Delete was pressed at the
    /// very start, which a text field doesn't otherwise report.
    static let mark: Character = "\u{200B}"

    let id = UUID()
    var kind: Kind
    /// The line as the editor holds it: the invisible first character, then the words with their formatting.
    /// Only for lines of text; the other kinds use `text`.
    var rich: AttributedString
    /// Source for the kinds that aren't a line of text: code, a table's Markdown, an image's Markdown.
    var text: String
    /// Leading spaces of a nested list item, kept exactly as written so the Markdown round-trips.
    var lead: String
    /// The extra "#"s of a heading deeper than three levels. Shown as a subheading, written back as it came.
    var deep: String

    init(kind: Kind, rich: AttributedString = AttributedString(), text: String = "", lead: String = "", deep: String = "") {
        self.kind = kind
        self.rich = AttributedString(String(Self.mark)) + rich
        self.text = text
        self.lead = lead
        self.deep = deep
    }

    /// The words and their formatting, without the invisible first character.
    var content: AttributedString {
        get {
            var c = rich
            if c.characters.first == Self.mark { c.characters.removeFirst() }
            return c
        }
        set { rich = AttributedString(String(Self.mark)) + newValue }
    }

    var plain: String { String(content.characters) }
    var level: Int { min(lead.count / 2, 6) }

    /// A line of formatted text, as opposed to code, a table, an image or a divider.
    var isLine: Bool {
        switch kind { case .code, .divider, .table, .image: false; default: true }
    }

    var isEmpty: Bool { isLine ? rich.characters.count <= 1 : text.isEmpty }

    var isListItem: Bool {
        switch kind { case .bullet, .numbered, .todo: true; default: false }
    }

    /// Kinds that carry on to the next line when you press Return.
    var continues: Kind? {
        switch kind {
        case .bullet, .numbered, .quote: kind
        case .todo: .todo(false)
        default: nil
        }
    }

    // MARK: Markdown → blocks

    private static let imagePattern = try! NSRegularExpression(pattern: #"!\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))+(?:\s+"[^"]*")?\)"#)

    /// Blocks are separated by a blank line, as the web editor writes them; a line break with no blank line
    /// (older notes) still starts a new block. Extra blank lines are empty lines left on purpose.
    static func parse(_ md: String) -> [Block] {
        let lines = md.components(separatedBy: "\n")
        var out: [Block] = []
        var i = 0
        var blanks = 0
        while i < lines.count {
            let l = lines[i].trimmingCharacters(in: .whitespaces)
            if l.isEmpty { blanks += 1; i += 1; continue }
            if !out.isEmpty, blanks > 2 { out += (0..<(blanks - 1) / 2).map { _ in Block(kind: .text) } }
            blanks = 0
            if l.hasPrefix("```") {
                var body: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") { body.append(lines[i]); i += 1 }
                i += 1 // closing fence
                out.append(Block(kind: .code(String(l.dropFirst(3))), text: body.joined(separator: "\n")))
            } else if l.hasPrefix("|") {
                var rows: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") { rows.append(lines[i].trimmingCharacters(in: .whitespaces)); i += 1 }
                out.append(Block(kind: .table, text: rows.joined(separator: "\n")))
            } else {
                out += line(lines[i])
                i += 1
            }
        }
        return out.isEmpty ? [Block(kind: .text)] : out
    }

    /// One line of Markdown. Usually one block; a picture in the middle of a sentence gets a block of its own.
    private static func line(_ raw: String) -> [Block] {
        let l = raw.trimmingCharacters(in: .whitespaces)
        if l.range(of: #"^(-{3,}|\*{3,}|_{3,})$"#, options: .regularExpression) != nil { return [Block(kind: .divider)] }
        if l == ">" { return [Block(kind: .quote)] }
        // A marker with nothing after it ("-", "##", "[ ]") is an empty block of that kind, never literal symbols.
        if ["-", "*", "+"].contains(l) { return [Block(kind: .bullet, lead: String(raw.prefix { $0 == " " || $0 == "\t" }))] }
        if l.range(of: #"^#{1,6}$"#, options: .regularExpression) != nil { return [Block(kind: l.count == 1 ? .h1 : l.count == 2 ? .h2 : .h3)] }
        if l.range(of: #"^([-*] )?\[ ?\]$"#, options: .regularExpression) != nil { return [Block(kind: .todo(false))] }
        let lead = String(raw.prefix { $0 == " " || $0 == "\t" })
        var kind = Kind.text
        // Two trailing spaces or a backslash is a Markdown line break; each line is its own block here anyway.
        var words = raw.replacingOccurrences(of: #"(  +|\\)$"#, with: "", options: .regularExpression)
        var indent = ""
        var deep = ""
        let prefixes: [(String, Kind)] = [("- [ ] ", .todo(false)), ("- [] ", .todo(false)), ("[ ] ", .todo(false)), ("[] ", .todo(false)), ("- [x] ", .todo(true)), ("- [X] ", .todo(true)), ("* [ ] ", .todo(false)), ("* [x] ", .todo(true)),
                                          ("### ", .h3), ("## ", .h2), ("# ", .h1), ("- ", .bullet), ("* ", .bullet), ("+ ", .bullet), ("> ", .quote)]
        if let (p, k) = prefixes.first(where: { l.hasPrefix($0.0) }) {
            kind = k
            words = String(l.dropFirst(p.count))
            if k == .bullet || k == .todo(false) || k == .todo(true) { indent = lead }
        } else if let r = l.range(of: #"^#{4,6} "#, options: .regularExpression) {
            kind = .h3
            deep = String(repeating: "#", count: l[r].count - 4)
            words = String(l[r.upperBound...])
        } else if let r = l.range(of: #"^\d+[.)] "#, options: .regularExpression) {
            kind = .numbered
            words = String(l[r.upperBound...])
            indent = lead
        }
        // Pictures come out of the sentence and follow it.
        let ns = words as NSString
        let pictures = imagePattern.matches(in: words, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
        for p in pictures { words = words.replacingOccurrences(of: p, with: "") }
        var out: [Block] = []
        if pictures.isEmpty || !words.trimmingCharacters(in: .whitespaces).isEmpty || kind != .text {
            out.append(Block(kind: kind, rich: Rich.parse(words), lead: indent, deep: deep))
        }
        return out + pictures.map { Block(kind: .image, text: $0) }
    }

    // MARK: Blocks → Markdown

    static func markdown(_ blocks: [Block]) -> String {
        let nums = numbers(blocks)
        var out = ""
        for i in blocks.indices {
            let b = blocks[i]
            // A blank line between blocks, except inside a list or a quote, which stay together.
            if i > 0 { out += joins(blocks, i) ? "\n" : "\n\n" }
            let words = b.isLine ? Rich.markdown(b.content) : ""
            switch b.kind {
            case .text: out += literal(words)
            case .h1: out += "# " + words
            case .h2: out += "## " + words
            case .h3: out += "###\(b.deep) " + words
            case .bullet: out += b.lead + "- " + words
            case .numbered: out += b.lead + "\(nums[i]). " + words
            case .todo(let done): out += b.lead + (done ? "- [x] " : "- [ ] ") + words
            case .quote: out += "> " + words
            case .code(let lang): out += "```\(lang)\n\(b.text)\n```"
            case .divider: out += "---"
            case .table, .image: out += b.text
            }
        }
        // Empty lines at the end aren't worth keeping.
        return out.replacingOccurrences(of: #"\n+$"#, with: "", options: .regularExpression)
    }

    /// A paragraph that happens to start like a list, heading, quote or table ("- ", "1. ", "#", ">", "|") gets a
    /// backslash, so it's still read as a paragraph.
    private static func literal(_ words: String) -> String {
        let t = words.drop { $0 == " " }
        guard let first = t.first, "#-+>|0123456789".contains(first) else { return words }
        let at = words.index(words.startIndex, offsetBy: words.count - t.count)
        if first.isNumber {
            guard let r = t.range(of: #"^\d+(?=[.)] )"#, options: .regularExpression) else { return words }
            return String(words[..<r.upperBound]) + "\\" + words[r.upperBound...]
        }
        guard t.range(of: #"^(#{1,6} |[-+] |>|\||-{3,} *$)"#, options: .regularExpression) != nil else { return words }
        return String(words[..<at]) + "\\" + words[at...]
    }

    /// Markdown with a blank line between blocks, the way the web editor reads it.
    static func tidy(_ md: String) -> String { markdown(parse(md)) }

    /// Whether block `i` continues the list or quote above it, so no blank line goes between them.
    private static func joins(_ blocks: [Block], _ i: Int) -> Bool {
        let b = blocks[i], prev = blocks[i - 1]
        if b.kind == .quote && prev.kind == .quote { return true }
        guard b.isListItem, prev.isListItem else { return false }
        // Nested under the item above, or the next item of the same list. A numbered list after bullets is a new list.
        var j = i - 1
        while j > 0, blocks[j].level > b.level, blocks[j - 1].isListItem { j -= 1 }
        return blocks[j].level != b.level || (blocks[j].kind == .numbered) == (b.kind == .numbered)
    }

    /// The number shown for each numbered item; nested items don't break their parent's count.
    static func numbers(_ blocks: [Block]) -> [Int] {
        var counters: [Int: Int] = [:]
        return blocks.map { b in
            switch b.kind {
            case .numbered:
                counters = counters.filter { $0.key <= b.level }
                counters[b.level, default: 0] += 1
                return counters[b.level]!
            case .bullet, .todo:
                counters = counters.filter { $0.key < b.level }
            default:
                counters = [:]
            }
            return 0
        }
    }

    /// The font a kind of line is written in.
    static func font(_ k: Kind) -> Font {
        switch k {
        case .h1: .title2.bold()
        case .h2: .title3.weight(.semibold)
        case .h3: .headline
        default: .body
        }
    }

    /// The line ready to show: fonts and colours worked out from its formatting.
    var styled: AttributedString {
        var c = content
        Rich.style(&c, base: Self.font(kind), done: kind == .todo(true))
        return c
    }
}

/// Apple Notes-style editor: checkboxes you can tap, bullets, headings, tables. Bold, links and the rest stay
/// formatted while you type. Markdown shortcuts work too ("- ", "[] ", "## ", "**bold**"), but the symbols
/// disappear as soon as they mean something. Return continues a list; Return on an empty list item ends it;
/// Delete at the start of a line joins it to the one above.
struct BlockEditor: View {
    @Binding var markdown: String
    var placeholder = "Start writing"
    /// Bump to put the cursor at the top of the text (Return in the title does this).
    var focusRequest = 0
    @State private var blocks: [Block] = []
    /// The line being edited.
    @State private var focus: UUID?
    @State private var lines = Lines()
    @State private var lastSaved = ""
    /// The blocks as Markdown when last loaded or saved. Opening an older note mustn't rewrite it just to tidy spacing.
    @State private var current = ""
    /// The line a link is being added to, kept while the address is typed (the alert takes the keyboard).
    @State private var linking: UUID?
    @State private var address = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            let paragraphs = paragraphs
            ForEach($blocks) { $b in
                row($b).padding(.top, paragraphs.contains(b.id) ? 8 : 0)
            }
            // Tap below the last line to keep writing.
            Color.clear.frame(height: 240).contentShape(.rect).onTapGesture { focusEnd() }
        }
        .padding(.top, 2)
        .onAppear(perform: load)
        .onChange(of: markdown) { if markdown != lastSaved { load() } }
        .onChange(of: blocks) { save() }
        .onChange(of: focusRequest) { focusStart() }
        .alert("Link", isPresented: Binding(get: { linking != nil }, set: { if !$0 { linking = nil } })) {
            TextField("https://", text: $address).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            Button("Cancel", role: .cancel) {}
            Button("Add") { addLink() }.disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    // MARK: Rows

    /// Paragraphs that follow another paragraph. They get a little air, so two paragraphs don't read as one.
    private var paragraphs: Set<UUID> {
        var out = Set<UUID>()
        for (prev, b) in zip(blocks, blocks.dropFirst()) where b.kind == .text && prev.kind == .text && !prev.isEmpty && !b.isEmpty {
            out.insert(b.id)
        }
        return out
    }

    @ViewBuilder private func row(_ b: Binding<Block>) -> some View {
        let block = b.wrappedValue
        switch block.kind {
        case .divider:
            Divider().padding(.vertical, 12).contentShape(.rect).contextMenu { lineMenu(block) }
        case .image:
            MarkdownImage(source: block.text).padding(.vertical, 6).contextMenu { lineMenu(block) }
        case .code:
            LineField(id: block.id, text: code(b), kind: block.kind, mode: .code, focus: $focus, lines: lines, events: events)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Color.secondary.opacity(0.08), in: .rect(cornerRadius: 10))
                .padding(.vertical, 4)
        case .table:
            TableEditor(source: b.text) { blocks.removeAll { $0.id == block.id } }
                .padding(.vertical, 6)
        default:
            line(b)
        }
    }

    @ViewBuilder private func line(_ b: Binding<Block>) -> some View {
        let block = b.wrappedValue
        let done = block.kind == .todo(true)
        let font = Block.font(block.kind)
        let height = LineText.font(block.kind, []).lineHeight
        HStack(alignment: .top, spacing: 8) {
            Group {
                switch block.kind {
                case .todo:
                    Button {
                        b.wrappedValue.kind = .todo(!done)
                    } label: {
                        Image(systemName: done ? "checkmark.square.fill" : "square")
                            .font(.title3).foregroundStyle(done ? Color.primary : Color.secondary)
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.plain)
                    .sensoryFeedback(.selection, trigger: done)
                    .accessibilityLabel(done ? "Done" : "Not done")
                case .bullet:
                    Text(block.level % 2 == 0 ? "•" : "◦").font(font).foregroundStyle(.secondary).frame(width: 12)
                case .numbered:
                    Text("\(number(of: block)).").font(font).monospacedDigit().foregroundStyle(.secondary)
                case .quote:
                    RoundedRectangle(cornerRadius: 1.5).fill(.quaternary).frame(width: 3)
                default:
                    EmptyView()
                }
            }
            .frame(minHeight: height)
            // Hold a bullet, number or checkbox to move, copy or remove its line.
            .contentShape(.rect)
            .contextMenu { if block.isListItem || block.kind == .quote { lineMenu(block) } }
            LineField(id: block.id, text: content(b), kind: block.kind, focus: $focus, lines: lines, events: events)
                .overlay(alignment: .topLeading) {
                    if block.isEmpty && blocks.count == 1 {
                        Text(placeholder).font(font).foregroundStyle(.tertiary).allowsHitTesting(false)
                    }
                }
        }
        .padding(.leading, CGFloat(block.level) * 22)
        .padding(.top, topPad(block.kind))
        .padding(.vertical, 3)
    }

    private func topPad(_ k: Block.Kind) -> CGFloat {
        switch k {
        case .h1: 12
        case .h2: 10
        case .h3: 6
        default: 0
        }
    }

    private func number(of b: Block) -> Int {
        guard let i = index(b.id) else { return 1 }
        return Block.numbers(blocks)[i]
    }

    private func index(_ id: UUID) -> Int? { blocks.firstIndex { $0.id == id } }

    // MARK: Typing

    private func content(_ b: Binding<Block>) -> Binding<AttributedString> {
        let id = b.wrappedValue.id
        return Binding(get: { b.wrappedValue.content }, set: { new in
            guard let i = index(id) else { return }
            blocks[i].content = new
        })
    }

    /// Code is plain text: no formatting, and its line breaks stay. A blank line at the end leaves the block.
    private func code(_ b: Binding<Block>) -> Binding<AttributedString> {
        let id = b.wrappedValue.id
        return Binding(get: { AttributedString(b.wrappedValue.text) }, set: { new in
            guard let i = index(id) else { return }
            let words = String(new.characters)
            if words.hasSuffix("\n\n") {
                blocks[i].text = String(words.dropLast(2))
                addLine(after: id)
            } else {
                blocks[i].text = words
            }
        })
    }

    private var events: LineEvents {
        LineEvents(
            split: split,
            deleteAtStart: joinUp,
            shortcut: shortcut,
            kind: { id in index(id).map { blocks[$0].kind } },
            checklist: { setKind(.todo(false)) },
            bullets: { setKind(.bullet) },
            menu: menu,
            hide: hideKeyboard,
            bold: { if let id = focus { lines.views[id]?.toggle(.bold); Haptics.tap() } },
            indent: indent
        )
    }

    private static let shortcuts: [(String, Block.Kind)] = [
        ("[] ", .todo(false)), ("[ ] ", .todo(false)), ("- [ ] ", .todo(false)), ("- ", .bullet), ("* ", .bullet), ("1. ", .numbered),
        ("### ", .h3), ("## ", .h2), ("# ", .h1), ("> ", .quote),
    ]

    /// A Markdown shortcut typed at the start of a line turns it into what it means.
    private func shortcut(_ id: UUID, _ plain: String) -> LineEvents.Shortcut {
        guard let i = index(id) else { return .none }
        switch blocks[i].kind {
        case .text:
            if plain == "---" {
                let divider = Block(kind: .divider)
                blocks[i] = divider
                addLine(after: divider.id)
                return .replaced
            }
            if plain.hasPrefix("```") {
                let code = Block(kind: .code(String(plain.dropFirst(3)).trimmingCharacters(in: .whitespaces)))
                blocks[i] = code
                focus = code.id
                return .replaced
            }
            guard let (p, k) = Self.shortcuts.first(where: { plain.hasPrefix($0.0) }) else { return .none }
            blocks[i].kind = k
            Haptics.tap() // "- " became a bullet: you feel it take
            return .strip(p.count)
        case .bullet:
            // "- [ ] " arrives as "- " (a bullet) and then "[ ] ".
            guard let p = ["[ ] ", "[] "].first(where: { plain.hasPrefix($0) }) else { return .none }
            blocks[i].kind = .todo(false)
            Haptics.tap()
            return .strip(p.count)
        default:
            return .none
        }
    }

    /// Return: the line splits where the cursor is. `text` is the whole line with the line break(s) in it.
    private func split(_ id: UUID, _ text: AttributedString, _ cursor: Int) {
        guard let i = index(id) else { return }
        var rest = text
        var parts: [AttributedString] = []
        while let nl = rest.characters.firstIndex(of: "\n") {
            parts.append(AttributedString(rest[..<nl]))
            rest = AttributedString(rest[rest.index(afterCharacter: nl)...])
        }
        parts.append(rest)
        // Return on an empty list item ends the list (or moves a nested one out a level).
        if parts.count == 2, parts.allSatisfy({ $0.characters.isEmpty }), blocks[i].continues != nil {
            if !blocks[i].lead.isEmpty {
                blocks[i].lead = outdented(i)
            } else {
                blocks[i].kind = .text
            }
            return
        }
        // Return at the very start of a line puts an empty line above it and leaves this one as it is.
        if parts.count == 2, parts[0].characters.isEmpty, !parts[1].characters.isEmpty {
            let above = Block(kind: blocks[i].continues ?? .text, lead: blocks[i].continues == nil ? "" : blocks[i].lead)
            blocks.insert(above, at: i)
            lines.cursor[id] = 0
            return
        }
        // The cursor goes to the new line, as far in as it was past the line break.
        let behind = text.characters.count - cursor
        blocks[i].content = parts[0]
        let cont = blocks[i].continues
        let lead = cont == nil ? "" : blocks[i].lead
        let next = parts.dropFirst().map { Block(kind: cont ?? .text, rich: $0, lead: lead) }
        blocks.insert(contentsOf: next, at: i + 1)
        if let last = next.last {
            let length = last.content.characters.count
            lines.cursor[last.id] = max(0, length - behind)
            focus = last.id
        }
    }

    /// Delete at the very start of a line.
    private func joinUp(_ id: UUID) {
        guard let i = index(id) else { return }
        if case .code = blocks[i].kind {
            // An empty code block goes away; otherwise Delete at its start does nothing.
            if blocks[i].text.isEmpty { remove(id) }
            return
        }
        if !blocks[i].lead.isEmpty {
            // First Delete on a nested item moves it out a level.
            blocks[i].lead = outdented(i)
        } else if blocks[i].kind != .text {
            // First Delete just turns a list item or heading back into plain text.
            blocks[i].kind = .text
            blocks[i].deep = ""
        } else if i > 0 {
            let prev = blocks[i - 1]
            switch prev.kind {
            case .divider, .image:
                // Delete under a divider or picture removes it.
                blocks.remove(at: i - 1)
            case .code, .table:
                if blocks[i].isEmpty {
                    blocks.remove(at: i)
                    if prev.kind == .table { hideKeyboard() } else { focus = prev.id }
                }
            default:
                lines.cursor[prev.id] = prev.content.characters.count
                blocks[i - 1].content = prev.content + blocks[i].content
                blocks.remove(at: i)
                focus = prev.id
            }
        }
    }

    // MARK: Focus

    private func hideKeyboard() {
        focus = nil
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func focusStart() {
        if let first = blocks.first(where: \.isLine) {
            lines.cursor[first.id] = 0
            focus = first.id
        } else {
            let line = Block(kind: .text)
            blocks.insert(line, at: 0)
            focus = line.id
        }
    }

    private func focusEnd() {
        if let last = blocks.last, last.isLine, last.isEmpty {
            focus = last.id
        } else if let last = blocks.last {
            addLine(after: last.id)
        }
    }

    /// Puts the cursor on a fresh line after a block.
    private func addLine(after id: UUID) {
        guard let i = index(id) else { return }
        let next = Block(kind: .text)
        blocks.insert(next, at: i + 1)
        focus = next.id
    }

    private func remove(_ id: UUID) {
        guard let i = index(id) else { return }
        let prev = i > 0 ? blocks[i - 1] : nil
        blocks.remove(at: i)
        if blocks.isEmpty { blocks = [Block(kind: .text)] }
        if let prev, prev.isLine { lines.cursor[prev.id] = prev.content.characters.count }
        focus = (prev?.isLine == true ? prev?.id : nil) ?? blocks.first?.id
    }

    // MARK: Toolbar

    private var focused: Int? { focus.flatMap(index) }

    /// The Format menu, built each time it opens so it reflects the line the cursor is on.
    private func menu() -> [UIMenuElement] {
        guard let i = focused else { return [] }
        let b = blocks[i]
        let view = lines.views[b.id]
        func action(_ title: String, _ symbol: String? = nil, on: Bool = false, _ run: @escaping () -> Void) -> UIAction {
            UIAction(title: title, image: symbol.map { UIImage(systemName: $0) } ?? nil, state: on ? .on : .off) { _ in run() }
        }
        var out: [UIMenuElement] = []
        if b.isLine {
            let linked = view?.hasLink ?? false
            out.append(UIMenu(options: .displayInline, preferredElementSize: .small, children: [
                action("Bold", "bold") { view?.toggle(.bold) },
                action("Italic", "italic") { view?.toggle(.italic) },
                action("Strikethrough", "strikethrough") { view?.toggle(.strike) },
                linked ? action("Remove link", "link.badge.minus") { view?.setLink(nil) }
                       : action("Link", "link") { address = ""; linking = b.id },
            ]))
        }
        out.append(UIMenu(options: .displayInline, preferredElementSize: .medium, children: [
            action("Title", "textformat.size.larger", on: b.kind == .h1) { setKind(.h1) },
            action("Heading", "textformat.size", on: b.kind == .h2 || b.kind == .h3) { setKind(.h2) },
            action("Body", "textformat", on: b.kind == .text) { setKind(.text, toggles: false) },
        ]))
        out.append(UIMenu(options: .displayInline, preferredElementSize: .medium, children: [
            action("Numbers", "list.number", on: b.kind == .numbered) { setKind(.numbered) },
            action("Quote", "text.quote", on: b.kind == .quote) { setKind(.quote) },
            action("Code", "curlybraces") { setKind(.code(""), toggles: false) },
        ]))
        out.append(UIMenu(options: .displayInline, preferredElementSize: .small, children: [
            action("Move up", "arrow.up") { move(b.id, -1) },
            action("Move down", "arrow.down") { move(b.id, 1) },
        ]))
        out.append(UIMenu(title: "Insert", image: UIImage(systemName: "plus"), children: [
            action("Table", "tablecells") { insert(Block(kind: .table, text: "|  |  |\n| --- | --- |\n|  |  |")) },
            action("Divider", "minus") { insert(Block(kind: .divider)) },
        ]))
        return out
    }

    /// Makes the line a heading, a list item and so on. Choosing what it already is turns it back into body text.
    private func setKind(_ k: Block.Kind, toggles: Bool = true) {
        guard let i = focused else { return }
        let same: Bool = {
            if case .todo = k, case .todo = blocks[i].kind { return true }
            return blocks[i].kind == k
        }()
        let kind = same && toggles ? Block.Kind.text : k
        Haptics.tap()
        if case .code = kind {
            // Code is a different kind of field, so the words move over as plain text.
            guard blocks[i].isLine else { return }
            let code = Block(kind: kind, text: blocks[i].plain)
            blocks[i] = code
            focus = code.id
            return
        }
        if !blocks[i].isLine {
            guard case .code = blocks[i].kind else { return }
            let line = Block(kind: kind, rich: AttributedString(blocks[i].text.replacingOccurrences(of: "\n", with: " ")))
            blocks[i] = line
            focus = line.id
            return
        }
        blocks[i].kind = kind
        blocks[i].deep = ""
        if !blocks[i].isListItem { blocks[i].lead = "" }
    }

    /// Moves a line up or down past its neighbour, keeping the cursor in it.
    private func move(_ id: UUID, _ by: Int) {
        guard let i = index(id), blocks.indices.contains(i + by) else { return Haptics.warning() }
        withAnimation(.snappy) { blocks.swapAt(i, i + by) }
        Haptics.tap()
        if blocks[i + by].isLine, focus != nil { focus = id }
    }

    private func duplicate(_ id: UUID) {
        guard let i = index(id) else { return }
        let b = blocks[i]
        let copy = Block(kind: b.kind, rich: b.content, text: b.text, lead: b.lead, deep: b.deep)
        withAnimation(.snappy) { blocks.insert(copy, at: i + 1) }
        Haptics.tap()
    }

    /// What a hold on a line's bullet, number or checkbox offers.
    @ViewBuilder private func lineMenu(_ block: Block) -> some View {
        let i = index(block.id) ?? 0
        Button("Move up", systemImage: "arrow.up") { move(block.id, -1) }.disabled(i == 0)
        Button("Move down", systemImage: "arrow.down") { move(block.id, 1) }.disabled(i >= blocks.count - 1)
        Button("Duplicate", systemImage: "plus.square.on.square") { duplicate(block.id) }
        Divider()
        Button(block.isLine ? "Delete line" : "Delete", systemImage: "trash", role: .destructive) { Haptics.thud(); withAnimation(.snappy) { remove(block.id) } }
    }

    /// Adds a divider or table under the line the cursor is on, and a fresh line after it.
    private func insert(_ block: Block) {
        guard let i = focused else { return }
        // An empty line turns into the new block instead of being left above it.
        if blocks[i].isLine, blocks[i].isEmpty, blocks[i].kind == .text {
            blocks[i] = block
        } else {
            blocks.insert(block, at: i + 1)
        }
        addLine(after: block.id)
    }

    private func addLink() {
        var s = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let id = linking, !s.isEmpty else { return }
        if !s.contains("://"), !s.hasPrefix("mailto:") { s = "https://" + s }
        guard let url = URL(string: s) else { return }
        lines.views[id]?.setLink(url)
        focus = id
    }

    /// Nest a list item under the one above it, or move it back out.
    private func indent(_ by: Int) {
        guard let i = focused, blocks[i].isListItem else { return }
        if by < 0 {
            guard !blocks[i].lead.isEmpty else { return Haptics.warning() }
            blocks[i].lead = outdented(i)
            return Haptics.tap()
        }
        // Only under an item above it, and one level at a time.
        guard i > 0, blocks[i - 1].isListItem, blocks[i - 1].lead.count >= blocks[i].lead.count else { return Haptics.warning() }
        Haptics.tap()
        var j = i - 1
        while j > 0, blocks[j].lead.count > blocks[i].lead.count, blocks[j - 1].isListItem { j -= 1 }
        // Markdown nests under "1. " with three spaces and under "- " with two.
        blocks[i].lead = blocks[j].lead + (blocks[j].kind == .numbered ? "   " : "  ")
    }

    /// The indent of the item this one is nested under, or none.
    private func outdented(_ i: Int) -> String {
        var j = i - 1
        while j >= 0, blocks[j].isListItem {
            if blocks[j].lead.count < blocks[i].lead.count { return blocks[j].lead }
            j -= 1
        }
        return ""
    }

    // MARK: Load and save

    private func load() {
        // Keep the cursor on the same line when a linked computer changes the note under us.
        let at = focused
        blocks = Block.parse(markdown)
        lastSaved = markdown
        current = Block.markdown(blocks)
        if let at, blocks.indices.contains(at) { focus = blocks[at].id }
    }

    private func save() {
        let md = Block.markdown(blocks)
        guard md != current else { return }
        current = md
        lastSaved = md
        markdown = md
    }
}

/// The margins a text view keeps around its words, so markers and placeholders can line up with them.
enum RichMetrics {
    /// What the text view adds above and below its words.
    static let inset: CGFloat = 8
    /// How much of that we take back, so lines sit as close as lines of one paragraph.
    static let trim: CGFloat = 6
    /// What's left above the words: where a bullet or checkbox starts.
    static let top: CGFloat = inset - trim
    static let side: CGFloat = 5
}

extension View {
    /// A text editor that looks like plain words on the page and is as tall as what's in it.
    func plainEditor() -> some View {
        scrollContentBackground(.hidden)
            .scrollDisabled(true)
            .fixedSize(horizontal: false, vertical: true)
    }
}

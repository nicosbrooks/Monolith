import SwiftUI
import UIKit
import Combine

/// Inline Markdown as formatted text, for places that only show it.
enum MD {
    /// Within each run of checklist lines, unchecked ones first and checked ones after (web's "Move checked to bottom").
    static func checkedLast(_ md: String) -> String {
        var out: [Substring] = [], run: [Substring] = []
        func isTask(_ l: Substring) -> Bool { let t = l.drop { $0 == " " || $0 == "\t" }; return t.hasPrefix("- [ ] ") || t.hasPrefix("- [x] ") }
        func flush() {
            out += run.filter { !$0.drop { $0 == " " || $0 == "\t" }.hasPrefix("- [x] ") }
            out += run.filter { $0.drop { $0 == " " || $0 == "\t" }.hasPrefix("- [x] ") }
            run = []
        }
        for l in md.split(separator: "\n", omittingEmptySubsequences: false) {
            if isTask(l) { run.append(l) } else { flush(); out.append(l) }
        }
        flush()
        return out.joined(separator: "\n")
    }

    static func inline(_ s: String, base: Font = .body) -> AttributedString { Rich.styled(s, base: base) }

    /// The text without any formatting, for list previews and search-like uses.
    static func plain(_ s: String) -> String { Rich.plain(s) }
}

/// Markdown tables as rows of cells, and back.
enum Table {
    private static let bar = "\u{E010}"

    /// Each row's cells as inline Markdown. The |---| line under the header isn't a row.
    static func rows(_ source: String) -> [[String]] {
        let all = source.components(separatedBy: "\n")
            .filter { $0.range(of: #"^\s*\|?[\s:|-]+\|?\s*$"#, options: .regularExpression) == nil || $0.range(of: "-") == nil }
            .map { line -> [String] in
                // A bar typed into a cell is written "\|" and isn't a column edge.
                var cells = line.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "\\|", with: bar)
                    .components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: bar, with: "\\|") }
                if cells.first == "" { cells.removeFirst() }
                if cells.last == "" { cells.removeLast() }
                return cells
            }
            .filter { !$0.isEmpty }
        let width = max(1, all.map(\.count).max() ?? 1)
        let padded = all.map { $0 + Array(repeating: "", count: width - $0.count) }
        return padded.isEmpty ? [Array(repeating: "", count: 2), Array(repeating: "", count: 2)] : padded
    }

    static func markdown(_ rows: [[String]]) -> String {
        guard let first = rows.first else { return "" }
        var lines = rows.map { "| " + $0.map { $0.isEmpty ? " " : $0 }.joined(separator: " | ") + " |" }
        lines.insert("| " + first.map { _ in "---" }.joined(separator: " | ") + " |", at: 1)
        return lines.joined(separator: "\n")
    }
}

/// A table for reading, as in study notes.
struct MarkdownTable: View {
    let source: String

    var body: some View {
        // Full width when it fits; a wide table scrolls sideways instead of squeezing its columns.
        ViewThatFits(in: .horizontal) {
            grid.frame(maxWidth: .infinity, alignment: .leading)
            ScrollView(.horizontal, showsIndicators: false) { grid }
        }
        .clipShape(.rect(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.quaternary))
    }

    private var grid: some View {
        let rows = Table.rows(source)
        return Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
            ForEach(rows.indices, id: \.self) { r in
                GridRow {
                    ForEach(rows[r].indices, id: \.self) { c in
                        Text(MD.inline(rows[r][c], base: Table.font(r)))
                            .font(Table.font(r))
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            // Each cell fills its column, so the header shading runs the full width.
                            .frame(minWidth: 72, maxWidth: .infinity, alignment: .leading)
                            .background(r == 0 ? Table.header : .clear)
                    }
                }
                if r < rows.count - 1 { Divider() }
            }
        }
    }
}

extension Table {
    static func font(_ row: Int) -> Font { row == 0 ? .subheadline.weight(.semibold) : .subheadline }
    static let header = Color.secondary.opacity(0.08)
}

/// A table you type straight into, cell by cell. Return moves down a row; the menu adds and removes rows and columns.
struct TableEditor: View {
    @Binding var source: String
    var onDelete: () -> Void
    @State private var cells: [[AttributedString]] = []
    /// What we last wrote, so our own saves don't reload the table under the cursor.
    @State private var written = ""
    @FocusState private var focus: Int?

    private var columns: Int { cells.first?.count ?? 0 }

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Group {
                // Up to three columns share the width; more scroll sideways.
                if columns > 3 {
                    ScrollView(.horizontal, showsIndicators: false) { grid(column: 150) }
                } else {
                    grid(column: nil)
                }
            }
            .clipShape(.rect(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(.quaternary))
            if focus != nil {
                Menu {
                    Button("Add row", systemImage: "plus") { change { $0.append(Array(repeating: AttributedString(), count: columns)) } }
                    Button("Add column", systemImage: "plus") { change { t in for r in t.indices { t[r].append(AttributedString()) } } }
                    if cells.count > 2 { Button("Remove last row", systemImage: "minus") { change { $0.removeLast() } } }
                    if columns > 1 { Button("Remove last column", systemImage: "minus") { change { t in for r in t.indices { t[r].removeLast() } } } }
                    Divider()
                    Button("Delete table", systemImage: "trash", role: .destructive, action: onDelete)
                } label: {
                    Label("Table", systemImage: "tablecells").font(.footnote).foregroundStyle(.secondary)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Theme.wash, in: .capsule)
                }
                .transition(.opacity)
            }
        }
        .animation(.snappy, value: focus != nil)
        .onAppear(perform: load)
        .onChange(of: source) { if source != written { load() } }
    }

    private func grid(column: CGFloat?) -> some View {
        Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
            ForEach(cells.indices, id: \.self) { r in
                GridRow {
                    ForEach(cells[r].indices, id: \.self) { c in
                        TextEditor(text: cell(r, c))
                            .focused($focus, equals: r * 100 + c)
                            .attributedTextFormattingDefinition(RichFormat(base: Table.font(r)))
                            .plainEditor()
                            .font(Table.font(r))
                            .padding(.horizontal, 7).padding(.vertical, 1)
                            .frame(width: column, alignment: .leading)
                            .frame(maxWidth: column == nil ? .infinity : nil, maxHeight: .infinity, alignment: .topLeading)
                            .background(r == 0 ? Table.header : .clear)
                    }
                }
                if r < cells.count - 1 { Divider() }
            }
        }
    }

    private func cell(_ r: Int, _ c: Int) -> Binding<AttributedString> {
        Binding(
            get: { cells.indices.contains(r) && cells[r].indices.contains(c) ? cells[r][c] : AttributedString() },
            set: { new in
                guard cells.indices.contains(r), cells[r].indices.contains(c), new != cells[r][c] else { return }
                guard new.characters.contains("\n") else {
                    cells[r][c] = new
                    write()
                    return
                }
                // Return goes down a row, adding one at the bottom.
                var words = new
                while let at = words.characters.firstIndex(of: "\n") { words.characters.remove(at: at) }
                cells[r][c] = words
                if r == cells.count - 1 { cells.append(Array(repeating: AttributedString(), count: columns)) }
                write()
                DispatchQueue.main.async { focus = (r + 1) * 100 + c }
            }
        )
    }

    private func change(_ edit: (inout [[AttributedString]]) -> Void) {
        edit(&cells)
        write()
    }

    private func load() {
        cells = Table.rows(source).enumerated().map { r, row in
            row.map { Rich.styled($0, base: Table.font(r)) }
        }
        written = source
    }

    private func write() {
        let md = Table.markdown(cells.map { $0.map { Rich.markdown($0).replacingOccurrences(of: "|", with: "\\|") } })
        guard md != source else { return }
        written = md
        source = md
    }
}

/// `![alt](src)` from a note: a web URL or an embedded data: image.
struct MarkdownImage: View {
    let source: String
    private static let cache = NSCache<NSString, UIImage>()

    private var src: String {
        guard let open = source.range(of: "]("), let close = source.lastIndex(of: ")") , open.upperBound <= close else { return "" }
        return String(source[open.upperBound..<close]).components(separatedBy: " ").first ?? ""
    }

    private var embedded: UIImage? {
        guard src.hasPrefix("data:"), let comma = src.firstIndex(of: ",") else { return nil }
        let key = "\(src.count)-\(src.hashValue)" as NSString
        if let hit = Self.cache.object(forKey: key) { return hit }
        guard let data = Data(base64Encoded: String(src[src.index(after: comma)...])), let img = UIImage(data: data) else { return nil }
        Self.cache.setObject(img, forKey: key)
        return img
    }

    /// The text inside `![…]`: the file's name for an attachment.
    private var alt: String {
        guard let open = source.range(of: "!["), let close = source.range(of: "](") , open.upperBound <= close.lowerBound else { return "" }
        return String(source[open.upperBound..<close.lowerBound])
    }

    /// Bumped when a file arrives from a computer, so a missing one shows as soon as it's here.
    @State private var arrivals = 0
    private var hash: String? { src.hasPrefix("monolith-file:") ? String(src.dropFirst("monolith-file:".count)) : nil }

    /// A stored picture, read once and kept in the cache.
    private func stored(_ h: String) -> UIImage? {
        let key = "file-\(h)" as NSString
        if let hit = Self.cache.object(forKey: key) { return hit }
        guard let m = FileStore.meta(h), m.type.hasPrefix("image/"), let d = FileStore.data(h), let img = UIImage(data: d) else { return nil }
        Self.cache.setObject(img, forKey: key)
        return img
    }

    @ViewBuilder private func fileCard(_ h: String) -> some View {
        let meta = FileStore.meta(h)
        HStack(spacing: 10) {
            Image(systemName: "doc").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(meta?.name ?? (alt.isEmpty ? "File" : alt)).lineLimit(1)
                Text(meta.map { ByteCountFormatter.string(fromByteCount: Int64($0.size), countStyle: .file) } ?? "Arrives when your computer is connected")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if let url = FileStore.url(h) {
                ShareLink(item: url) { Text("Open") }.buttonStyle(.bordered).controlSize(.small)
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))
    }

    var body: some View {
        Group {
            if let h = hash {
                // Files are kept by hash, as on the computer. Pictures show; anything else is a card to open or share.
                let _ = arrivals
                if let img = stored(h) { Image(uiImage: img).resizable().scaledToFit() } else { fileCard(h) }
            } else if let img = embedded {
                Image(uiImage: img).resizable().scaledToFit()
            } else {
                AsyncImage(url: URL(string: src)) { phase in
                    if let image = phase.image { image.resizable().scaledToFit() }
                    else { RoundedRectangle(cornerRadius: 10).fill(.quaternary).frame(height: 160).overlay { Image(systemName: "photo").foregroundStyle(.secondary) } }
                }
            }
        }
        .clipShape(.rect(cornerRadius: 10))
        .frame(maxWidth: .infinity, alignment: .leading)
        .onReceive(NotificationCenter.default.publisher(for: FileStore.arrived)) { n in
            if let h = n.object as? String, h == hash { arrivals += 1 }
        }
    }
}

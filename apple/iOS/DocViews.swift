import SwiftUI
import SwiftData

/// Docs, recordings and folders in one place, as cards (like the web's Docs page). Chips across the top choose
/// what shows: All, Docs, Recordings, then each folder. Hold a folder's chip to rename or delete it.
struct DocsView: View {
    @Environment(\.modelContext) private var ctx
    @Environment(LectureRecorder.self) private var recorder
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    @State private var path: [Item] = []
    @State private var query = ""
    @State private var showDeleted = false
    @State private var naming = false
    @State private var folderName = ""
    @State private var renaming = false
    @AppStorage(Folders.key) private var emptyFolders = ""
    /// "all", "docs", "recordings" or "folder:<name>". Remembered, and set from outside to show a folder.
    @AppStorage(DocsView.chipKey) private var chip = "all"
    @AppStorage("docs.layout") private var layout = "grid"
    @Namespace private var zoom
    @Environment(\.horizontalSizeClass) private var size

    static let chipKey = "docs.chip"
    /// Shows a folder's docs next time Docs is on screen.
    static func show(folder: String?) { UserDefaults.standard.set(folder.map { "folder:\($0)" } ?? "all", forKey: chipKey) }

    private var folders: [String] { Folders.all(items, emptyFolders) }
    private var folder: String? { chip.hasPrefix("folder:") ? String(chip.dropFirst(7)) : nil }
    private var shown: [Item] {
        items.filter { i in
            let kindOK: Bool = switch chip {
            case "docs": i.kind == .doc || i.kind == .note
            case "recordings": i.kind == .lecture
            default: folder.map { i.folder == $0 } ?? true
            }
            return kindOK && (query.isEmpty || i.title.localizedCaseInsensitiveContains(query) || i.body.localizedCaseInsensitiveContains(query))
        }
    }
    private var title: String { folder ?? (chip == "recordings" ? "Recordings" : "Docs") }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    chips
                    if shown.isEmpty { empty } else { grid }
                }
                .padding(.horizontal, Space.page)
                .padding(.bottom, 40)
                .frame(maxWidth: 1100)
                .frame(maxWidth: .infinity)
            }
            .paper()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search docs")
            .navigationTitle(title)
            .drawerButton()
            .navigationBarTitleDisplayMode(.large)
            .navigationDestination(for: Item.self) { ItemDetail(item: $0).navigationTransition(.zoom(sourceID: $0.id, in: zoom)) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { moreMenu }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
                ToolbarItem(placement: .topBarTrailing) {
                    Button { create() } label: { Image(systemName: chip == "recordings" ? "mic" : "square.and.pencil") }
                        .accessibilityLabel(chip == "recordings" ? "Record" : "New doc")
                        .disabled(chip == "recordings" && recorder.isRecording)
                }
            }
            .sheet(isPresented: $showDeleted) { DeletedView() }
            .alert("New folder", isPresented: $naming) {
                TextField("Name", text: $folderName)
                Button("Cancel", role: .cancel) {}
                Button("Create") {
                    let name = folderName.trimmingCharacters(in: .whitespaces)
                    guard !name.isEmpty else { return }
                    Folders.create(name)
                    withAnimation(.snappy) { chip = "folder:\(name)" }
                }
                .disabled(folderName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .folderRename(folder ?? "", isPresented: $renaming, text: $folderName)
            // Something to open (a new doc, a recording, a link): push it here.
            .task(id: router.pending?.id) {
                guard let p = router.pending else { return }
                router.pending = nil
                path = [p]
            }
            // A folder that's gone (deleted or renamed elsewhere) falls back to All.
            .onChange(of: folders) { if let f = folder, !folders.contains(f) { chip = "all" } }
        }
    }

    // MARK: Chips

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chipButton("All", "all")
                chipButton("Docs", "docs")
                chipButton("Recordings", "recordings")
                ForEach(folders, id: \.self) { f in
                    chipButton(f, "folder:\(f)", symbol: "folder")
                        .folderActions(f) { path = [$0] }
                }
                Button { folderName = ""; naming = true } label: {
                    Image(systemName: "plus").font(.subheadline.weight(.semibold))
                        .frame(width: 36, height: 36)
                        .glassEffect(.regular.interactive(), in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("New folder")
            }
            .padding(.vertical, 4)
        }
        .scrollClipDisabled()
    }

    private func chipButton(_ name: String, _ id: String, symbol: String? = nil) -> some View {
        let on = chip == id
        return Button { Haptics.tap(); withAnimation(.snappy) { chip = id } } label: {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).font(.caption.weight(.semibold)) }
                Text(name).font(.subheadline.weight(on ? .semibold : .regular)).lineLimit(1)
            }
            .padding(.horizontal, 14).frame(height: 36)
            .foregroundStyle(on ? Theme.paper : .primary)
            .background { if on { Capsule().fill(Color.primary) } }
            .glassEffect(on ? .identity : .regular.interactive(), in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: Cards

    private var columns: [GridItem] {
        if layout == "list" { return [GridItem(.flexible())] }
        return [GridItem(.adaptive(minimum: size == .compact ? 150 : 220), spacing: 12)]
    }

    private var grid: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(shown) { item in
                NavigationLink(value: item) { DocCard(item: item, lines: layout == "list" ? 1 : 3) }
                    .buttonStyle(.card)
                    .matchedTransitionSource(id: item.id, in: zoom)
                    .itemMenu(item, folders: folders)
            }
        }
        .animation(.snappy, value: chip)
    }

    @ViewBuilder private var empty: some View {
        if !query.isEmpty {
            ContentUnavailableView.search(text: query)
        } else if chip == "recordings" {
            WarmEmpty(title: "No recordings yet", message: "Record a class or a meeting and get notes written for you.", action: "Record") { create() }
        } else if let folder {
            WarmEmpty(title: "\(folder) is empty", message: "Docs you make here are filed in it.", action: "New doc") { create() }
        } else {
            WarmEmpty(title: "Nothing written yet", message: "A doc is a page for anything: notes, plans, a draft.", action: "New doc") { create() }
        }
    }

    private var moreMenu: some View {
        Menu {
            Picker("Layout", selection: $layout) {
                Label("Cards", systemImage: "square.grid.2x2").tag("grid")
                Label("List", systemImage: "list.bullet").tag("list")
            }
            Section {
                Button("New folder", systemImage: "folder.badge.plus") { folderName = ""; naming = true }
                if let folder {
                    Button("Rename \u{201C}\(folder)\u{201D}", systemImage: "pencil") { folderName = folder; renaming = true }
                    Button("Delete \u{201C}\(folder)\u{201D}", systemImage: "trash", role: .destructive) {
                        Folders.delete(folder, in: ctx)
                        withAnimation(.snappy) { chip = "all" }
                    }
                }
            }
            Section { Button("Recently Deleted", systemImage: "trash") { showDeleted = true } }
        } label: { Icon.more }
        .accessibilityLabel("More")
    }

    private func create() {
        if chip == "recordings" {
            guard !recorder.isRecording else { return }
            let l = Item(.lecture, title: "Recording · \(Date.now.formatted(.dateTime.month(.abbreviated).day()))")
            ctx.insert(l)
            path = [l]
            recorder.start(l)
            return
        }
        let d = Item(.doc)
        d.folder = folder
        ctx.insert(d)
        path = [d]
    }
}

private struct DocNode: View {
    var doc: Item
    var all: [Item]
    var folders: [String] = []
    @Environment(\.modelContext) private var ctx
    @State private var expanded = false

    var body: some View {
        let kids = all.filter { $0.parent?.id == doc.id }
        if kids.isEmpty {
            row
        } else {
            DisclosureGroup(isExpanded: $expanded) {
                ForEach(kids) { DocNode(doc: $0, all: all, folders: folders) }
            } label: { row }
        }
    }

    private var row: some View {
        ItemLink(item: doc) { ItemRow(item: doc) }
        .itemMenu(doc, folders: folders)
        .swipeActions(edge: .trailing) { Button(role: .destructive) { doc.trash() } label: { Image(systemName: "trash") } }
        .listRowBackground(Color.clear)
    }
}


struct PageEmoji: View {
    var item: Item
    @Binding var picking: Bool
    private let icons = ["📗", "📕", "📙", "🧠", "🧪", "📐", "🧮", "🌍", "🎓", "💡", "📝", "🗂️", "🔬", "🎯"]

    var body: some View {
        if let emoji = item.displayEmoji {
            Text(emoji).font(.system(size: 40))
        }
        if picking {
            VStack(alignment: .leading, spacing: 8) {
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(44)), count: 4), spacing: 8) {
                    ForEach(icons, id: \.self) { emoji in
                        Button { setEmoji(emoji) } label: { Text(emoji).font(.title) }.buttonStyle(.plain)
                    }
                }
                if item.displayEmoji != nil { Button("Remove emoji") { setEmoji(nil) } }
                Button("Cancel") { picking = false }
            }
        }
    }

    private func setEmoji(_ emoji: String?) {
        item.emoji = emoji
        item.touch()
        picking = false
    }
}

/// Read-only Markdown, drawn the same way the editor draws it. Used for study notes.
struct MarkdownBlocks: View {
    var markdown: String

    var body: some View {
        let blocks = Block.parse(markdown).filter { $0.kind != .text || !$0.plain.trimmingCharacters(in: .whitespaces).isEmpty }
        let nums = Block.numbers(blocks)
        VStack(alignment: .leading, spacing: 10) {
            ForEach(blocks.indices, id: \.self) { i in
                block(blocks[i], number: nums[i]).padding(.leading, CGFloat(blocks[i].level) * 22)
            }
        }
        .textSelection(.enabled)
    }

    @ViewBuilder private func block(_ b: Block, number: Int) -> some View {
        let text = Text(b.styled).font(Block.font(b.kind))
        switch b.kind {
        case .h1: text.padding(.top, 10)
        case .h2: text.padding(.top, 10)
        case .h3: text.padding(.top, 6)
        case .todo(let done):
            Label { text.foregroundStyle(done ? .secondary : .primary) }
                icon: { Image(systemName: done ? "checkmark.square.fill" : "square").foregroundStyle(.secondary) }
        case .bullet:
            HStack(alignment: .firstTextBaseline, spacing: 10) { Text(b.level % 2 == 0 ? "•" : "◦").foregroundStyle(.secondary); text }
        case .numbered:
            HStack(alignment: .firstTextBaseline, spacing: 8) { Text("\(number).").monospacedDigit().foregroundStyle(.secondary); text }
        case .quote:
            text.foregroundStyle(.secondary)
                .padding(.leading, 12).overlay(alignment: .leading) { Rectangle().fill(.quaternary).frame(width: 3) }
        case .code:
            Text(b.text).font(.system(.callout, design: .monospaced))
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.secondary.opacity(0.08), in: .rect(cornerRadius: 10))
        case .divider: Divider().padding(.vertical, 6)
        case .table: MarkdownTable(source: b.text)
        case .image: MarkdownImage(source: b.text)
        case .text: text
        }
    }
}

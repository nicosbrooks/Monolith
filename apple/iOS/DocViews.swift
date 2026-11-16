import SwiftUI
import SwiftData

/// All writing in one place (notes were merged into docs): pinned first, then top-level docs, newest first,
/// with sub-docs folded under their parent. A folder shows just its docs.
struct DocsView: View {
    var folder: String? = nil
    @Environment(\.modelContext) private var ctx
    @Query(filter: #Predicate<Item> { $0.kindRaw == "doc" && $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var docs: [Item]
    @State private var path: [Item] = []
    @State private var query = ""
    @State private var showDeleted = false
    @State private var naming = false
    @State private var folderName = ""
    @Environment(\.openItem) private var openItem

    private var folders: [String] { Array(Set(docs.compactMap(\.folder))).sorted() }
    private var searching: Bool { !query.isEmpty }
    private var shown: [Item] {
        docs.filter { (folder == nil || $0.folder == folder)
            && (!searching || $0.title.localizedCaseInsensitiveContains(query) || $0.body.localizedCaseInsensitiveContains(query)) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if folder != nil || searching {
                    ForEach(shown) { row($0) }
                } else {
                    ForEach(shown.filter(\.pinned)) { row($0) }
                    ForEach(shown.filter { !$0.pinned && $0.parent == nil }) { DocNode(doc: $0, all: docs, folders: folders) }
                }
            }
            .compactList()
            .overlay {
                if shown.isEmpty {
                    if searching { ContentUnavailableView.search(text: query) }
                    else { EmptyState(symbol: "doc.text", title: "No docs yet", message: "Tap the pencil to start writing.") }
                }
            }
            .searchable(if: docs.count > 8, text: $query)
            .navigationTitle(folder ?? "Docs")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Item.self) { ItemDetail(item: $0) }
            .opensPending(.doc, path: $path)
            .drawerButton()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("New folder", systemImage: "folder.badge.plus") { folderName = ""; naming = true }
                        Button("Recently Deleted", systemImage: "trash") { showDeleted = true }
                    } label: { Image(systemName: "ellipsis") }
                }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
                ToolbarItem(placement: .topBarTrailing) {
                    Button { let d = Item(.doc); d.folder = folder; open(d) } label: { Image(systemName: "square.and.pencil") }.accessibilityLabel("New doc")
                }
            }
            .sheet(isPresented: $showDeleted) { DeletedView() }
            .alert("New folder", isPresented: $naming) {
                TextField("Name", text: $folderName)
                Button("Cancel", role: .cancel) {}
                Button("Create") {
                    // A folder exists once something is in it, so start it with a doc.
                    let name = folderName.trimmingCharacters(in: .whitespaces)
                    guard !name.isEmpty else { return }
                    let d = Item(.doc); d.folder = name; open(d)
                }
                .disabled(folderName.trimmingCharacters(in: .whitespaces).isEmpty)
            } message: { Text("Opens a first doc inside it. Move others in from their ··· menu.") }
        }
    }

    private func row(_ d: Item) -> some View {
        ItemLink(item: d) { ItemRow(item: d) }
            .swipeActions(edge: .leading) { Button { d.toggleFavorite() } label: { Image(systemName: d.pinSymbol) }.tint(.orange) }
            .swipeActions(edge: .trailing) { Button(role: .destructive) { d.trash() } label: { Image(systemName: "trash") } }
            .itemMenu(d, folders: folders)
    }

    private func open(_ d: Item) {
        ctx.insert(d)
        if let openItem { openItem(d) } else { path.append(d) }
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
        .swipeActions(edge: .leading) { Button { doc.toggleFavorite() } label: { Image(systemName: doc.pinSymbol) }.tint(.orange) }
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


/// The web app's folder menu: a new doc in this folder, or delete the folder (its docs stay in Docs).
private struct FolderActions: ViewModifier {
    var name: String
    var onNewDoc: (Item) -> Void
    @Environment(\.modelContext) private var ctx
    @Query(filter: #Predicate<Item> { $0.folder != nil }) private var filed: [Item]
    @State private var confirming = false
    private var inside: [Item] { filed.filter { $0.folder == name } }

    func body(content: Content) -> some View {
        content
            .contextMenu {
                Button("New doc", systemImage: "doc.badge.plus") { let d = Item(.doc); d.folder = name; ctx.insert(d); onNewDoc(d) }
                Section { Button("Delete folder", systemImage: "trash", role: .destructive) { confirming = true } }
            }
            .confirmationDialog("Delete “\(name)”?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Delete folder", role: .destructive) {
                    let docs = inside
                    docs.forEach { $0.folder = nil }
                    Toaster.shared.show("Folder deleted", action: ("Undo", { docs.forEach { $0.folder = name } }))
                }
            } message: {
                let n = inside.filter { $0.deletedAt == nil }.count
                Text(n == 0 ? "Nothing is deleted." : "Its \(n) doc\(n == 1 ? "" : "s") stay in Docs. Nothing is deleted.")
            }
    }
}

extension View {
    func folderActions(_ name: String, onNewDoc: @escaping (Item) -> Void) -> some View { modifier(FolderActions(name: name, onNewDoc: onNewDoc)) }
}

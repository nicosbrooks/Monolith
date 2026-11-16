import SwiftUI
import SwiftData

/// Recordings: one plain list, newest first, pinned on top.
struct ItemListView: View {
    let kind: ItemKind
    @Environment(\.modelContext) private var ctx
    @Environment(LectureRecorder.self) private var recorder
    @Query private var items: [Item]
    @State private var path: [Item] = []
    @State private var query = ""
    @State private var showDeleted = false
    @Environment(\.openItem) private var openItem

    init(kind: ItemKind) {
        self.kind = kind
        let raw = kind.rawValue
        _items = Query(filter: #Predicate<Item> { $0.kindRaw == raw && $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse)
    }

    private var filtered: [Item] {
        items.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || $0.transcript.contains { $0.text.localizedCaseInsensitiveContains(query) } }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List { rows(filtered.filter(\.pinned) + filtered.filter { !$0.pinned }) }
                .compactList()
                .overlay {
                    if filtered.isEmpty {
                        if query.isEmpty { EmptyState(symbol: kind.symbol, title: "No recordings yet", message: "Record a class or a meeting to get a transcript.") }
                        else { ContentUnavailableView.search(text: query) }
                    }
                }
                .searchable(if: items.count > 8, text: $query)
                .navigationTitle("Recordings")
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(for: Item.self) { ItemDetail(item: $0) }
                .drawerButton()
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu { Button("Recently Deleted", systemImage: "trash") { showDeleted = true } } label: { Image(systemName: "ellipsis") }
                    }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            let l = Item(.lecture, title: "Recording · \(Date.now.formatted(.dateTime.month(.abbreviated).day()))")
                            ctx.insert(l)
                            if let openItem { openItem(l) } else { path.append(l) }
                            recorder.start(l)
                        } label: { Image(systemName: "mic") }
                        .disabled(recorder.isRecording)
                        .accessibilityLabel("Record")
                    }
                }
                .sheet(isPresented: $showDeleted) { DeletedView() }
                .opensPending(kind, path: $path)
        }
    }

    @ViewBuilder private func rows(_ list: [Item]) -> some View {
        ForEach(list) { item in
            ItemLink(item: item) { ItemRow(item: item) }
                .swipeActions(edge: .leading) {
                    Button { item.toggleFavorite() } label: { Image(systemName: item.pinSymbol) }.tint(.orange)
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { item.trash() } label: { Image(systemName: "trash") }
                }
                .itemMenu(item)
        }
    }
}

extension View {
    /// Plain list: no dividing lines; rows are told apart by height and spacing, like the web app.
    func compactList() -> some View {
        listStyle(.plain)
            .environment(\.defaultMinListRowHeight, Space.row)
            .listSectionSpacing(.compact)
            .contentMargins(.top, 8, for: .scrollContent)
            .contentMargins(.horizontal, 4, for: .scrollContent)
            .paper()
    }
}

/// Same symbols and words as the web app: docs are favourites (a star), recordings pin to the top.
extension Item {
    var pinSymbol: String { kind == .lecture ? (pinned ? "pin.slash" : "pin") : (pinned ? "star.slash" : "star") }
    var pinLabel: String { kind == .lecture ? (pinned ? "Unpin" : "Pin to top") : (pinned ? "Remove from favorites" : "Add to favorites") }
}

struct ItemMenu: View {
    var item: Item
    var folders: [String] = []
    /// Called after Delete, so an open editor can step back.
    var onDelete: (() -> Void)? = nil
    /// Editor-only options (emoji, sketch, checklist), placed after favorites like the web's ··· menu.
    var extra: AnyView? = nil
    /// Off in the editor, where the star sits in the header (as on the web).
    var showFavorite = true
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil && $0.folder != nil }) private var filed: [Item]

    private var allFolders: [String] { Array(Set(folders + filed.compactMap(\.folder))).sorted() }

    /// The web app's doc menu, in its order: Add sub-doc, favorites, Move to, then Delete.
    var body: some View {
        if item.kind == .doc {
            Button("Add sub-doc", systemImage: "doc.badge.plus") {
                let d = Item(.doc, parent: item); d.folder = item.folder
                ctx.insert(d); router.open(d)
            }
        }
        if showFavorite { Button(item.pinLabel, systemImage: item.pinSymbol) { item.toggleFavorite() } }
        if let extra { extra }
        if item.kind == .doc && !allFolders.isEmpty {
            Menu {
                Picker("Move to folder", selection: Binding(get: { item.folder }, set: { item.folder = $0; item.touch() })) {
                    Label("No folder", systemImage: "tray").tag(String?.none)
                    ForEach(allFolders, id: \.self) { Label($0, systemImage: "folder").tag(String?.some($0)) }
                }
                .pickerStyle(.inline)
            } label: { Label("Move to folder", systemImage: "folder") }
        }
        if item.kind == .doc { Section {
            Button("Copy as Markdown", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = "# \(item.displayTitle)\n\n\(item.body)"
                Toaster.shared.show("Copied as Markdown")
            }
            ShareLink(item: "# \(item.displayTitle)\n\n\(item.body)") { Label("Export Markdown", systemImage: "square.and.arrow.down") }
        } }
        Section {
            Button("Delete", systemImage: "trash", role: .destructive) { item.trash(); onDelete?() }
        }
    }
}

/// One line, like Notion: icon, title, and a quiet date (or length, for recordings).
struct ItemRow: View {
    var item: Item
    var showKind = false
    var body: some View {
        HStack(spacing: 14) {
            Group {
                if let e = item.displayEmoji { Text(e) }
                else { Image(systemName: item.pinned ? (item.kind == .lecture ? "pin" : "star") : item.kind.symbol).foregroundStyle(.secondary) }
            }
            .font(.body).frame(width: 22)
            Text(item.displayTitle).lineLimit(1)
                .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            Spacer(minLength: 8)
            Text(item.kind == .lecture && item.duration > 0 ? item.duration.clock : item.updatedAt.shortRelative)
                .font(.footnote.monospacedDigit()).foregroundStyle(.tertiary)
        }
    }
}

struct ItemDetail: View {
    var item: Item
    @Environment(LectureRecorder.self) private var recorder
    @Environment(Router.self) private var router
    var body: some View {
        Group {
            switch item.kind {
            case .note, .doc: NoteEditor(item: item)
            case .lecture: LectureView(item: item)
            }
        }
    }
}

/// A note: a title, then live blocks (checklists, bullets, headings). A sketch area below takes Apple Pencil.
struct NoteEditor: View {
    @Bindable var item: Item
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @State private var sketching = false
    @State private var picking = false
    @FocusState private var titleFocused: Bool
    @State private var bodyFocus = 0

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    PageEmoji(item: item, picking: $picking)
                    TextField("Untitled", text: $item.title, axis: .vertical)
                        .font(.title.bold())
                        .focused($titleFocused)
                        .submitLabel(.next)
                    BlockEditor(markdown: $item.body, placeholder: "Start writing", focusRequest: bodyFocus)
                }
                .frame(maxWidth: 720, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .frame(maxHeight: sketching ? 260 : .infinity)
            if sketching {
                Divider()
                SketchCanvas(data: $item.drawing)
            } else if let d = item.drawing {
                Button { withAnimation(.snappy) { sketching = true } } label: {
                    SketchPreview(data: d).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.bottom, 12)
                }
                .buttonStyle(.plain)
            }
        }
        .background(Theme.paper.ignoresSafeArea())
        .onChange(of: item.body) { item.touch() }
        .onChange(of: item.title) { titleChanged() }
        .onChange(of: item.drawing) { item.touch() }
        .onAppear { if item.title.isEmpty && item.body.isEmpty && item.drawing == nil { titleFocused = true } }
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { router.reading = item }
        .onDisappear {
            if router.reading?.id == item.id { router.reading = nil }
            // A doc left blank isn't kept, so trying "New doc" never leaves an "Untitled" behind.
            if item.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && item.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && item.drawing == nil && item.deletedAt == nil && !item.pinned && (item.children ?? []).isEmpty {
                ctx.delete(item)
            }
        }
        // Two buttons: favorite, and ··· for the rest (Listen is in there). While it reads aloud, a stop button
        // takes Listen's place up here, so it can be stopped in one tap.
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if Speaker.shared.speakingID == item.id {
                    Button { Speaker.shared.toggle(item) } label: { Image(systemName: "stop.fill") }
                        .accessibilityLabel("Stop reading")
                }
                Button { item.toggleFavorite() } label: { Image(systemName: item.pinned ? "star.fill" : "star") }
                    .accessibilityLabel(item.pinLabel)
                Menu {
                    ItemMenu(item: item, onDelete: { dismiss() }, extra: AnyView(Group {
                        Button("Listen", systemImage: "speaker.wave.2") { Speaker.shared.toggle(item) }
                        Button(item.displayEmoji == nil ? "Add emoji" : "Change emoji", systemImage: "face.smiling") { picking = true }
                        Button(sketching ? "Close sketch" : "Sketch", systemImage: "pencil.line") { withAnimation(.snappy) { sketching.toggle() } }
                        if item.body.contains("- [x] ") {
                            Button("Move checked to bottom", systemImage: "line.3.horizontal.decrease") { item.body = MD.checkedLast(item.body) }
                            Button("Uncheck all", systemImage: "checkmark.square") { item.body = item.body.replacingOccurrences(of: "- [x] ", with: "- [ ] ") }
                        }
                    }), showFavorite: false)
                } label: { Image(systemName: "ellipsis") }
                .accessibilityLabel("More options")
            }
        }
    }

    /// Return in the title moves on to the body instead of starting a second title line.
    private func titleChanged() {
        if item.title.contains(where: \.isNewline) {
            item.title = item.title.filter { !$0.isNewline }
            titleFocused = false
            bodyFocus += 1
        }
        item.touch()
    }
}

struct DeletedView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var ctx
    @Query(filter: #Predicate<Item> { $0.deletedAt != nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    @State private var forever: Item?
    var body: some View {
        NavigationStack {
            List {
              if !items.isEmpty {
                Text("Touch and hold to recover, or swipe.").font(.footnote).foregroundStyle(.secondary)
                    .listRowSeparator(.hidden).listRowBackground(Color.clear)
              }
              ForEach(items) { item in
                ItemRow(item: item, showKind: true)
                    .listRowSeparator(.hidden).listRowBackground(Color.clear)
                    .contextMenu {
                        Button("Recover", systemImage: "arrow.counterclockwise") { recover(item) }
                        Section { Button("Delete forever", systemImage: "trash", role: .destructive) { forever = item } }
                    }
                    .swipeActions(edge: .leading) {
                        Button { recover(item) } label: { Label("Recover", systemImage: "arrow.counterclockwise") }.tint(.blue)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button { forever = item } label: { Label("Delete forever", systemImage: "trash") }.tint(.red)
                    }
            }
            }
            .compactList()
            .confirmationDialog("Delete this \(forever?.kind == .lecture ? "recording" : "doc") forever?",
                                isPresented: Binding(get: { forever != nil }, set: { if !$0 { forever = nil } }),
                                titleVisibility: .visible, presenting: forever) { item in
                Button("Delete forever", role: .destructive) {
                    if let audio = item.audioURL { try? FileManager.default.removeItem(at: audio) }
                    ctx.delete(item)
                }
            } message: { _ in Text("This can’t be undone.") }
            .overlay { if items.isEmpty { EmptyState(symbol: "trash", title: "Nothing here", message: "Deleted notes, docs and recordings wait here until you remove them.") } }
            .navigationTitle("Recently Deleted")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func recover(_ item: Item) {
        item.deletedAt = nil
        Toaster.shared.show("\(item.kind == .lecture ? "Recording" : "Doc") recovered")
    }
}

struct SearchView: View {
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    @State private var query = ""
    var body: some View {
        NavigationStack {
            List(results) { item in ItemLink(item: item) { ItemRow(item: item, showKind: true) } }
                .compactList()
                .overlay {
                    if query.isEmpty { EmptyState(symbol: "magnifyingglass", title: "Search everything", message: "Notes, docs and recordings.") }
                    else if results.isEmpty { ContentUnavailableView.search(text: query) }
                }
                .navigationTitle("Search")
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(for: Item.self) { ItemDetail(item: $0) }
                .drawerButton()
                .searchable(text: $query)
        }
    }
    private var results: [Item] {
        guard !query.isEmpty else { return [] }
        return items.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.body.localizedCaseInsensitiveContains(query) || $0.transcript.contains { $0.text.localizedCaseInsensitiveContains(query) } }
    }
}

/// A conversation with the assistant about the workspace. Opened from the chat bar with the first message.
/// Every answer says which docs it used, and can be copied, saved as a doc, or added to the doc it was asked from.
struct ChatView: View {
    var first: String
    /// The doc the question was asked from: it leads the context, like the web's "Ask about …".
    var about: Item? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    @Query(sort: \Event.start) private var events: [Event]
    @FocusState private var focused: Bool
    @AppStorage("assistantModel") private var choice = "default"
    struct Turn { var q: String; var a: String?; var sources: [Item] = []; var failed = false }
    @State private var turns: [Turn] = []
    @State private var query = ""
    @State private var request: Task<Void, Never>?
    @State private var settings = false
    @State private var conversation = Assistant.Conversation()

    private var text: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The items most related to the question, best first, with how well each matched.
    private func ranked(for prompt: String) -> [(item: Item, score: Int)] {
        let terms = Set(prompt.lowercased().split { !$0.isLetter && !$0.isNumber }.filter { $0.count >= 4 }.map(String.init))
        return items.map { item in
            let title = item.displayTitle.lowercased()
            let content = (item.body + " " + item.transcript.prefix(24).map(\.text).joined(separator: " ")).lowercased()
            return (item, terms.reduce(0) { $0 + (title.contains($1) ? 3 : content.contains($1) ? 1 : 0) })
        }
        .sorted { $0.score != $1.score ? $0.score > $1.score : $0.item.updatedAt > $1.item.updatedAt }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 32) {
                        ForEach(Array(turns.enumerated()), id: \.offset) { i, t in
                            turnView(t).id(i)
                        }
                        if !Assistant.isAvailable {
                            Text(Assistant.ModelError.unavailable.localizedDescription).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: 640, alignment: .leading)
                    .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 24)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: turns.count) { withAnimation(.snappy) { proxy.scrollTo(turns.count - 1, anchor: .top) } }
            }
            .navigationTitle(about.map { $0.displayTitle } ?? "Ask Monolith")
            .navigationSubtitle(Assistant.modelName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("Close")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { settings = true } label: { Image(systemName: "slider.horizontal.3") }.accessibilityLabel("Assistant settings")
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ChatField(text: $query, focused: $focused, busy: request != nil,
                          prompt: about.map { "Ask about \u{201C}\($0.displayTitle)\u{201D}" } ?? "Ask a follow-up",
                          send: { send(text) }, stop: stopAnswer) { EmptyView() }
                    .padding(.horizontal, 14).padding(.top, 24).padding(.bottom, 8)
                    .background(Fog())
            }
            .background(Theme.paper.ignoresSafeArea())
            .sheet(isPresented: $settings) { SettingsSheet() }
        }
        .onAppear { if turns.isEmpty { send(first) } }
        .onDisappear { request?.cancel(); request = nil }
    }

    @ViewBuilder private func turnView(_ t: Turn) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(t.q)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(Theme.card, in: .rect(cornerRadius: 22, style: .continuous))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.leading, 56)
            if let a = t.a {
                if t.failed {
                    Label { Text(a) } icon: { Image(systemName: "exclamationmark.circle") }
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    MarkdownBlocks(markdown: a).textSelection(.enabled)
                    if !t.sources.isEmpty { sourcesView(t.sources) }
                    if request == nil || turns.last?.q != t.q { actions(a) }
                }
            } else { progress }
        }
    }

    /// The docs this answer drew on, by name. Tap one to open it.
    private func sourcesView(_ sources: [Item]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(sources.count == 1 ? "Source" : "Sources").font(.footnote.weight(.medium)).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(sources) { item in
                        Button { dismiss(); router.open(item) } label: {
                            Label(item.displayTitle, systemImage: item.kind.symbol).font(.footnote).lineLimit(1)
                                .padding(.horizontal, 12).frame(height: 32)
                                .background(Theme.wash, in: .capsule)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    /// The web panel's answer actions: copy, insert into the open doc, or keep it as a new doc.
    private func actions(_ a: String) -> some View {
        HStack(spacing: 4) {
            action("Copy", "doc.on.doc") { UIPasteboard.general.string = a; Toaster.shared.show("Copied") }
            if let about {
                action("Add to doc", "text.append") {
                    about.body += (about.body.hasSuffix("\n") || about.body.isEmpty ? "" : "\n\n") + a
                    about.touch()
                    Toaster.shared.show("Added to \u{201C}\(about.displayTitle)\u{201D}")
                }
            } else {
                action("Save as doc", "doc.badge.plus") {
                    let title = turns.last?.q ?? "Answer"
                    let d = Item(.doc, title: String(title.prefix(80)), body: a)
                    ctx.insert(d)
                    Toaster.shared.show("Saved to Docs", action: ("Open", { dismiss(); router.open(d) }))
                }
            }
        }
        .padding(.leading, -8)
    }

    private func action(_ label: String, _ symbol: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Label(label, systemImage: symbol).font(.footnote.weight(.medium)).foregroundStyle(.secondary)
                .padding(.horizontal, 10).frame(height: 32).contentShape(.capsule)
        }
        .buttonStyle(.row)
    }

    @ViewBuilder private var progress: some View {
        let models = OpenModels.shared
        if let model = Assistant.openModel(for: choice), models.preparingID == model.id, case .loading(let fraction) = models.phase {
            ProgressView(value: fraction) { Text("Preparing \(model.name)").font(.footnote) }
        } else {
            Text("Thinking")
                .font(.subheadline).foregroundStyle(.secondary)
                .symbolEffect(.pulse, options: .repeating)
                .phaseAnimator([0.45, 1]) { v, o in v.opacity(o) } animation: { _ in .easeInOut(duration: 0.9) }
        }
    }

    private func stopAnswer() {
        request?.cancel(); request = nil
        if let i = turns.indices.last, turns[i].a == nil { turns[i].a = "Stopped."; turns[i].failed = true }
    }

    private func send(_ raw: String) {
        let prompt = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, request == nil, Assistant.isAvailable else { return }
        let ranking = ranked(for: prompt)
        let picked = ranking.prefix(6).map(\.item)
        // Only what actually matched counts as a source, plus the doc it was asked from.
        var sources = ranking.filter { $0.score > 0 }.prefix(3).map(\.item)
        if let about { sources.removeAll { $0.id == about.id }; sources.insert(about, at: 0) }
        let notes = picked.filter { $0.id != about?.id }.map { item in
            "From \(item.displayTitle): \(String((item.body + " " + item.transcript.prefix(12).map(\.text).joined(separator: " ")).prefix(600)))"
        }
        let start = Calendar.current.startOfDay(for: .now)
        let end = Calendar.current.date(byAdding: .day, value: 7, to: start) ?? start
        let schedule = agenda(events, from: start, to: end).prefix(16).map {
            "- \(Assistant.day($0.start))\($0.allDay ? " all day" : " " + $0.start.formatted(date: .omitted, time: .shortened) + "–" + $0.end.formatted(date: .omitted, time: .shortened)): \($0.title)\(($0.location ?? "").isEmpty ? "" : " @ " + ($0.location ?? ""))"
        }.joined(separator: "\n")
        let tasks = items.filter { $0.kind != .lecture }
            .flatMap { i in Tasks.open(in: i.body).map { "- \(MD.plain($0)) (in \(i.displayTitle))" } }
            .prefix(12).joined(separator: "\n")
        let open = about.map { "Open doc, \($0.displayTitle):\n\(String($0.body.prefix(2400)))" }
        // What the turned-on integrations know (place, weather, travel time, recent places).
        let device = Integrations.shared.context
        // Short, exact things first so trimming never cuts them. They're sent once per conversation; the
        // session remembers them, and earlier turns, so follow-ups only carry the question and new notes.
        let fixed = Assistant.dates + "\n" + (device.isEmpty ? "" : device + "\n")
            + "Calendar:\n\(schedule.isEmpty ? "(nothing scheduled)" : schedule)\n" + (tasks.isEmpty ? "" : "Open tasks:\n\(tasks)\n")
        let pieces = (open.map { [$0] } ?? []) + notes
        Integrations.shared.refresh()
        query = ""
        turns.append(Turn(q: prompt, a: nil, sources: Array(sources)))
        let index = turns.count - 1
        request = Task {
            defer { if !Task.isCancelled { request = nil } }
            do {
                // Show the answer word by word as the model writes it.
                let r = try await conversation.ask(prompt, fixed: fixed, pieces: pieces) { partial in
                    if !partial.isEmpty, !Task.isCancelled, turns.indices.contains(index) { turns[index].a = partial }
                }
                if !Task.isCancelled {
                    if r.isEmpty { turns[index].a = "No answer came back. Try asking again."; turns[index].failed = true }
                    else { turns[index].a = r }
                }
            } catch {
                if !Task.isCancelled { turns[index].a = error.localizedDescription; turns[index].failed = true }
            }
        }
    }
}

/// The composer: fogged-glass field with a round send button, used by the chat bar and inside the chat.
struct ChatField<Leading: View>: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    var busy = false
    var prompt = "Ask Monolith"
    var send: () -> Void
    /// While an answer is being written, the button stops it.
    var stop: (() -> Void)? = nil
    @ViewBuilder var leading: Leading
    private var empty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    /// The button only appears when it can do something: send what's typed, or stop an answer.
    private var showsButton: Bool { busy ? stop != nil : !empty }
    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            leading
            HStack(alignment: .bottom, spacing: 8) {
                TextField(prompt, text: $text, axis: .vertical)
                    .lineLimit(1...6).focused(focused)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .padding(.vertical, 13)
                    .frame(minHeight: 48)
                if showsButton {
                    Button { busy ? stop?() : send() } label: {
                        Image(systemName: busy ? "stop.fill" : "arrow.up").font(.subheadline.weight(.bold))
                            .frame(width: 36, height: 36)
                            .foregroundStyle(Theme.paper)
                            .background(Color.primary, in: .circle)
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 6)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
                    .accessibilityLabel(busy ? "Stop" : "Send")
                }
            }
            .padding(.leading, 20).padding(.trailing, showsButton ? 6 : 20)
            .glassEffect(.regular, in: .rect(cornerRadius: 24, style: .continuous))
            .animation(.snappy(duration: 0.2), value: showsButton)
        }
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
    }
}

extension ChatField where Leading == EmptyView {
    init(text: Binding<String>, focused: FocusState<Bool>.Binding, busy: Bool = false, send: @escaping () -> Void) {
        self.init(text: text, focused: focused, busy: busy, send: send) { EmptyView() }
    }
}

/// The soft fade behind a bottom bar, so content dissolves under it instead of hard-clipping.
struct Fog: View {
    var body: some View {
        LinearGradient(stops: [.init(color: Theme.paper.opacity(0), location: 0),
                               .init(color: Theme.paper.opacity(0.92), location: 0.22),
                               .init(color: Theme.paper, location: 0.34)], startPoint: .top, endPoint: .bottom)
            // Only under the home indicator, not behind the keyboard, or the solid part ends up out of sight.
            .ignoresSafeArea(.container, edges: .bottom)
            .allowsHitTesting(false)
    }
}

extension View {
    /// Search only appears once a list is long enough to need it.
    @ViewBuilder func searchable(if on: Bool, text: Binding<String>) -> some View {
        if on { searchable(text: text, placement: .navigationBarDrawer(displayMode: .automatic)) } else { self }
    }
}

/// What a hold on a doc or recording shows above its menu: the first lines, so you can check it's the right one
/// without opening it.
struct ItemPeek: View {
    var item: Item
    var body: some View {
        let words = Self.readable(item.body)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let e = item.displayEmoji { Text(e) } else { Image(systemName: item.kind.symbol).foregroundStyle(.secondary) }
                Text(item.displayTitle).font(.headline).lineLimit(2)
            }
            Text(words.isEmpty ? "Empty" : String(words.prefix(600)))
                .font(.subheadline).foregroundStyle(words.isEmpty ? .tertiary : .secondary)
                .lineLimit(9)
            Text("Edited \(item.updatedAt.shortRelative)").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(18)
        .frame(width: 320, alignment: .leading)
        .background(Theme.raised)
    }
    /// The doc as words: no heading marks, quote marks or checkbox brackets, and no runs of blank lines.
    static func readable(_ md: String) -> String {
        MD.plain(md).components(separatedBy: "\n").map { line in
            var l = line.trimmingCharacters(in: .whitespaces)
            for (pattern, with) in [(#"^#{1,6}\s+"#, ""), (#"^>\s?"#, ""), (#"^[-*+]\s+\[[ xX]?\]\s*"#, "☐ "), (#"^\[[ xX]?\]\s*"#, "☐ "), (#"^[-*+]\s+"#, "• ")] {
                l = l.replacingOccurrences(of: pattern, with: with, options: .regularExpression)
            }
            return l
        }
        .joined(separator: "\n")
        .replacingOccurrences(of: #"\n{2,}"#, with: "\n", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

extension View {
    /// Hold a doc or recording: a preview of it and its menu.
    func itemMenu(_ item: Item, folders: [String] = []) -> some View {
        contextMenu { ItemMenu(item: item, folders: folders) } preview: { ItemPeek(item: item) }
    }
}

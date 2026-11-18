import SwiftUI
import SwiftData

/// Ask: the assistant and search in one place, at the end of the tab row. Typing shows the docs that match as you
/// go; sending asks the assistant. With nothing typed it offers a few starting points from what's on today.
struct AskScreen: View {
    /// Opened over the page (from the iPhone drawer's search): it has Done, and closes before chat opens.
    var sheet = false
    @Environment(\.dismiss) private var dismiss
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    @Query(sort: \Event.start) private var events: [Event]
    @Query private var todos: [Todo]
    @State private var text = ""
    @FocusState private var focused: Bool
    @State private var path: [Item] = []

    private var query: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var matches: [Item] {
        guard query.count > 1 else { return [] }
        return Array(items.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.body.localizedCaseInsensitiveContains(query) }.prefix(12))
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.section) {
                    if query.isEmpty { start } else { results }
                }
                .padding(.horizontal, Space.page)
                .padding(.top, 8).padding(.bottom, 40)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .paper()
            // The question is the heading; no second title above it.
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Item.self) { ItemDetail(item: $0) }
            .toolbar { if sheet { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } } }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ChatField(text: $text, focused: $focused, prompt: "Ask or search", send: send) { EmptyView() }
                    .padding(.horizontal, 14).padding(.top, 8).padding(.bottom, 10)
            }
            .onAppear {
                Assistant.warm()
                if router.focusAsk { router.focusAsk = false; focused = true }
            }
            .onChange(of: router.focusAsk) { if router.focusAsk { router.focusAsk = false; focused = true } }
        }
    }

    // MARK: Nothing typed: starting points

    @ViewBuilder private var start: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(Assistant.isAvailable ? "What can I help with?" : "Search everything")
                .font(.title2.weight(.semibold))
            Text(Assistant.isAvailable ? "Ask about your docs, recordings, tasks and calendar. It all stays on this \(Linker.deviceName)."
                 : "Docs, recordings and tasks. Turn on the assistant in Settings to ask questions too.")
                .font(.subheadline).foregroundStyle(.secondary)
        }
        if Assistant.isAvailable && !starters.isEmpty {
            Panel(title: "Start from here") {
                ForEach(starters, id: \.text) { s in
                    Button { ask(s.text, about: s.about) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: s.symbol).font(.subheadline).foregroundStyle(.tint).frame(width: 22)
                            Text(s.text).multilineTextAlignment(.leading).lineLimit(2)
                            Spacer(minLength: 6)
                            Image(systemName: "arrow.up.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, minHeight: Space.row, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.row)
                    .accessibilityHint("Asks the assistant")
                }
            }
        }
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Recent").groupLabel()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(items.prefix(8)) { item in
                            NavigationLink(value: item) { DocCard(item: item).frame(width: 200) }
                                .buttonStyle(.card)
                                .itemMenu(item)
                        }
                    }
                }
                .scrollClipDisabled()
            }
        }
    }

    private struct Starter { var symbol: String; var text: String; var about: Item? = nil }

    private var starters: [Starter] {
        var out: [Starter] = []
        let now = Date.now
        if let next = events.first(where: { $0.end > now && $0.start < now.addingTimeInterval(36 * 3600) }) {
            out.append(Starter(symbol: "calendar", text: "Help me get ready for \u{201C}\(next.title)\u{201D}"))
        }
        let open = Todos.open(todos)
        if open.count > 1 { out.append(Starter(symbol: "checklist", text: "Which of my \(open.count) tasks should I do first?")) }
        else if let t = open.first { out.append(Starter(symbol: "checklist", text: "Help me with \u{201C}\(t.title)\u{201D}")) }
        if let doc = router.reading ?? items.first(where: { $0.kind == .doc && !$0.body.isEmpty }) {
            out.append(Starter(symbol: "doc.text", text: "Summarize \u{201C}\(doc.displayTitle)\u{201D}", about: doc))
        }
        if let rec = items.first(where: { $0.kind == .lecture && !$0.transcript.isEmpty }) {
            out.append(Starter(symbol: "waveform", text: "What were the key points of \u{201C}\(rec.displayTitle)\u{201D}?", about: rec))
        }
        return Array(out.prefix(4))
    }

    // MARK: Typing: matches, and the question

    @ViewBuilder private var results: some View {
        if Assistant.isAvailable {
            Button { send() } label: {
                HStack(spacing: 12) {
                    Image(systemName: "sparkle").foregroundStyle(.tint).frame(width: 22)
                    Text("Ask \u{201C}\(query)\u{201D}").lineLimit(2).multilineTextAlignment(.leading)
                    Spacer(minLength: 6)
                    Image(systemName: "return").font(.footnote).foregroundStyle(.tertiary)
                }
                .padding(.horizontal, Space.card)
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .panel()
            }
            .buttonStyle(.card)
        }
        if matches.isEmpty {
            Text("No docs match \u{201C}\(query)\u{201D}").font(.subheadline).foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("In your docs").groupLabel()
                LazyVStack(spacing: 10) {
                    ForEach(matches) { item in
                        NavigationLink(value: item) { DocCard(item: item, lines: 1) }
                            .buttonStyle(.card)
                            .itemMenu(item)
                    }
                }
            }
        }
    }

    private func send() {
        let q = query
        guard !q.isEmpty else { return }
        guard Assistant.isAvailable else { return }
        focused = false
        text = ""
        ask(q, about: router.reading)
    }

    /// Chat opens over the app, so a sheet steps aside first.
    private func ask(_ q: String, about: Item?) {
        guard sheet else { return router.ask(question: q, about: about) }
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { router.ask(question: q, about: about) }
    }
}

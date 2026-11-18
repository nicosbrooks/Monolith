import SwiftUI
import SwiftData

// MARK: - Opening items in a split view

/// Opens an item in the editor column. Always compares equal, so views that read it aren't redrawn every time
/// the split view updates.
struct ItemOpener: Equatable {
    let open: (Item) -> Void
    func callAsFunction(_ item: Item) { open(item) }
    static func == (a: ItemOpener, b: ItemOpener) -> Bool { true }
}

extension EnvironmentValues {
    /// Set on iPad: lists call this instead of pushing, so the item opens in the editor column.
    @Entry var openItem: ItemOpener? = nil
    @Entry var selectedItemID: UUID? = nil
}

/// A list row that pushes on iPhone and selects into the editor column on iPad.
struct ItemLink<Label: View>: View {
    var item: Item
    @ViewBuilder var label: Label
    @Environment(\.openItem) private var openItem
    @Environment(\.selectedItemID) private var selected

    var body: some View {
        if let openItem {
            Button { openItem(item) } label: { label.frame(maxWidth: .infinity, alignment: .leading).contentShape(.rect) }
                .buttonStyle(.plain)
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 12).fill(selected == item.id ? Theme.wash : .clear).padding(.horizontal, 8)
                )
        } else {
            NavigationLink(value: item) { label }.listRowSeparator(.hidden)
        }
    }
}

// MARK: - Keyboard shortcuts

struct Creator {
    var create: (ItemKind) -> Void
    var newEvent: () -> Void
    var search: () -> Void
}

extension FocusedValues {
    @Entry var creator: Creator? = nil
}

struct CreateCommands: Commands {
    @FocusedValue(\.creator) private var creator
    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Doc") { creator?.create(.doc) }.keyboardShortcut("n")
            Button("New Doc") { creator?.create(.doc) }.keyboardShortcut("n", modifiers: [.command, .option])
            Button("Start Recording") { creator?.create(.lecture) }.keyboardShortcut("r", modifiers: [.command, .shift])
            Button("New Event") { creator?.newEvent() }.keyboardShortcut("e", modifiers: [.command, .shift])
        }
        CommandGroup(after: .textEditing) {
            Button("Search Everything") { creator?.search() }.keyboardShortcut("k")
        }
    }
}

// MARK: - iPad root

/// iPad and wide windows: the sidebar (places, folders, Recent) beside the page, like the web's rail kept open.
/// A doc opens on the page, in that place's own stack, with Back to return.
struct PadRoot: View {
    @Environment(\.modelContext) private var ctx
    @Environment(LectureRecorder.self) private var recorder
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    @State private var section: PadSection = .today
    @State private var showSettings = false
    @State private var visibility = NavigationSplitViewVisibility.all
    @AppStorage(Folders.key) private var emptyFolders = ""
    @AppStorage(DocsView.chipKey) private var chip = "all"
    private var folders: [String] { Folders.all(items, emptyFolders) }

    var body: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            List {
                Section {
                    place("Home", "house", .today)
                    place("Tasks", "checklist", .tasks)
                    place("Docs", "doc.text", .docs)
                    place("Calendar", "calendar", .calendar)
                    place("Ask", "sparkle.magnifyingglass", .ask)
                }
                if !folders.isEmpty {
                    Section {
                        ForEach(folders, id: \.self) { f in
                            row(f, "folder", on: section == .docs && chip == "folder:\(f)") {
                                DocsView.show(folder: f); section = .docs
                            }
                            .folderActions(f) { router.open($0) }
                        }
                    } header: { Text("Folders").groupLabel() }
                }
                if !items.isEmpty {
                    Section {
                        ForEach(items.prefix(6)) { item in
                            row(item.displayTitle, item.kind == .lecture ? "waveform" : "doc.text", on: false) { router.open(item) }
                                .itemMenu(item, folders: folders)
                        }
                    } header: { Text("Recent").groupLabel() }
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
            .navigationTitle("Monolith")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Settings")
                }
                ToolbarItem(placement: .topBarTrailing) { NewMenu { Image(systemName: "plus") } }
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 320)
        } detail: {
            Group {
                switch section {
                case .today: TodayView()
                case .tasks: TasksScreen()
                case .docs: DocsView()
                case .calendar: CalendarScreen()
                case .ask: AskScreen()
                }
            }
            .id(section)
        }
        .background { Wash() }
        .modifier(Toasts(bottom: recorder.isRecording ? 84 : 20))
        .overlay(alignment: .bottom) {
            if recorder.isRecording {
                RecordingAccessory()
                    .frame(maxWidth: 420, minHeight: 52)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.bottom, 16)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: recorder.isRecording)
        .modifier(Routes(section: $section))
        .sheet(isPresented: $showSettings) { SettingsSheet() }
        .focusedSceneValue(\.creator, Creator(create: create, newEvent: { router.createEvent() }, search: { section = .ask; router.focusAsk = true }))
    }

    private func place(_ title: String, _ symbol: String, _ s: PadSection) -> some View {
        row(title, symbol, on: section == s && (s != .docs || !chip.hasPrefix("folder:"))) {
            if s == .docs, chip.hasPrefix("folder:") { DocsView.show(folder: nil) }
            section = s
        }
    }

    private func row(_ title: String, _ symbol: String, on: Bool, run: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); withAnimation(.snappy) { run() } } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol).frame(width: 22)
                    .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                Text(title).lineLimit(1).fontWeight(on ? .semibold : .regular)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 40)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .listRowBackground(
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? Color.primary.opacity(0.09) : .clear).padding(.horizontal, 8)
        )
        .listRowSeparator(.hidden)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func create(_ kind: ItemKind) {
        let item: Item
        switch kind {
        case .lecture:
            guard !recorder.isRecording else { return }
            item = Item(.lecture, title: "Recording · \(Date.now.formatted(.dateTime.month(.abbreviated).day()))")
            recorder.start(item)
        case .note, .doc:
            item = Item(.doc)
            if chip.hasPrefix("folder:") { item.folder = String(chip.dropFirst(7)) }
        }
        ctx.insert(item)
        router.open(item)
    }
}

// MARK: - Week grid (iPad calendar detail)

struct WeekGrid: View {
    @Environment(\.modelContext) private var ctx
    @Query(sort: \Event.start) private var events: [Event]
    @State private var anchor = Calendar.current.startOfDay(for: .now)
    @State private var editing: Event?
    @State private var newAt: Date?

    private let hours = 7..<23
    private let hourHeight: CGFloat = 56
    private var days: [Date] {
        let cal = Calendar.current
        let start = cal.dateInterval(of: .weekOfYear, for: anchor)?.start ?? anchor
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: start) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Color.clear.frame(width: 52)
                ForEach(days, id: \.self) { d in
                    let today = Calendar.current.isDateInToday(d)
                    VStack(spacing: 2) {
                        Text(d.formatted(.dateTime.weekday(.abbreviated))).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                        Text(d.formatted(.dateTime.day())).font(.title3.weight(today ? .bold : .regular).monospacedDigit())
                            .foregroundStyle(today ? .white : .primary)
                            .frame(width: 34, height: 34)
                            .background(today ? Color.blue : .clear, in: .circle)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 8)
            Divider()
            ScrollView {
                GeometryReader { geo in
                    let colW = (geo.size.width - 52) / 7
                    ZStack(alignment: .topLeading) {
                        ForEach(Array(hours.enumerated()), id: \.offset) { i, h in
                            HStack(alignment: .top, spacing: 0) {
                                Text(Calendar.current.date(bySettingHour: h, minute: 0, second: 0, of: .now)!.formatted(.dateTime.hour()))
                                    .font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
                                    .frame(width: 46, alignment: .trailing).padding(.trailing, 6).offset(y: -6)
                                Rectangle().fill(.quaternary).frame(height: 0.5)
                            }
                            .offset(y: CGFloat(i) * hourHeight)
                        }
                        // Tap an empty slot to add an event there.
                        ForEach(Array(days.enumerated()), id: \.offset) { di, d in
                            Color.clear.contentShape(.rect)
                                .frame(width: colW, height: CGFloat(hours.count) * hourHeight)
                                .offset(x: 52 + CGFloat(di) * colW)
                                .onTapGesture { p in
                                    let h = hours.lowerBound + Int(p.y / hourHeight)
                                    newAt = Calendar.current.date(bySettingHour: h, minute: 0, second: 0, of: d)
                                }
                        }
                        ForEach(events.filter { e in days.contains { Calendar.current.isDate(e.start, inSameDayAs: $0) } && !e.allDay }) { e in
                            let di = days.firstIndex { Calendar.current.isDate(e.start, inSameDayAs: $0) } ?? 0
                            let y = offset(e.start)
                            let h = max(offset(e.end) - y, 24)
                            Button { editing = e } label: {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(e.title).font(.caption.weight(.semibold)).lineLimit(2)
                                    Text(e.start.formatted(date: .omitted, time: .shortened)).font(.caption2).opacity(0.8)
                                }
                                .padding(6)
                                .frame(width: colW - 4, height: h, alignment: .topLeading)
                                .foregroundStyle(.blue)
                                .background(.blue.opacity(0.12), in: .rect(cornerRadius: 6))
                                .overlay(alignment: .leading) { Rectangle().fill(.blue).frame(width: 3).clipShape(.rect(cornerRadius: 1.5)) }
                            }
                            .buttonStyle(.plain)
                            .offset(x: 52 + CGFloat(di) * colW + 2, y: y)
                            .opacity(e.end < .now ? 0.5 : 1)
                        }
                        if days.contains(where: { Calendar.current.isDateInToday($0) }) {
                            let di = days.firstIndex { Calendar.current.isDateInToday($0) }!
                            Rectangle().fill(.red).frame(width: colW, height: 1.5)
                                .overlay(alignment: .leading) { Circle().fill(.red).frame(width: 8, height: 8).offset(x: -4) }
                                .offset(x: 52 + CGFloat(di) * colW, y: offset(.now))
                        }
                    }
                }
                .frame(height: CGFloat(hours.count) * hourHeight)
                .padding(.top, 10)
            }
        }
        .navigationTitle(anchor.formatted(.dateTime.month(.wide).year()))
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { shift(-7) } label: { Image(systemName: "chevron.left") }.keyboardShortcut(.leftArrow, modifiers: .command)
                Button("Today") { anchor = Calendar.current.startOfDay(for: .now) }.keyboardShortcut("t", modifiers: .command)
                Button { shift(7) } label: { Image(systemName: "chevron.right") }.keyboardShortcut(.rightArrow, modifiers: .command)
            }
        }
        .sheet(item: $editing) { EventEditor(event: $0) }
        .sheet(isPresented: Binding(get: { newAt != nil }, set: { if !$0 { newAt = nil } })) {
            EventEditor(event: nil, day: newAt ?? .now, at: newAt)
        }
    }

    private func offset(_ d: Date) -> CGFloat {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return (CGFloat(c.hour ?? 0) + CGFloat(c.minute ?? 0) / 60 - CGFloat(hours.lowerBound)) * hourHeight
    }

    private func shift(_ days: Int) {
        withAnimation(.snappy) { anchor = Calendar.current.date(byAdding: .day, value: days, to: anchor)! }
    }
}

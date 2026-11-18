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

enum PadSection: Hashable {
    case today, tasks, folder(String), lectures, docs, calendar, search, integrations
}

/// iPad and wide windows: sidebar, then a list, then the editor.
struct PadRoot: View {
    @Environment(\.modelContext) private var ctx
    @Environment(LectureRecorder.self) private var recorder
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }) private var items: [Item]
    @State private var section: PadSection? = .today
    @State private var selection: Item?
    @State private var newEvent = false
    @State private var showDeleted = false
    @State private var showSettings = false
    @State private var visibility = NavigationSplitViewVisibility.all
    @State private var compactColumn = NavigationSplitViewColumn.content
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var size

    @AppStorage(Folders.key) private var emptyFolders = ""
    private var folders: [String] { Folders.all(items, emptyFolders) }

    var body: some View {
        NavigationSplitView(columnVisibility: $visibility, preferredCompactColumn: $compactColumn) {
            List(selection: $section) {
                Section {
                    Label("Home", systemImage: "square.grid.2x2").tag(PadSection.today).sideRow(size)
                    Label("Tasks", systemImage: "checklist").tag(PadSection.tasks).sideRow(size)
                    Label("Docs", systemImage: "doc.text").tag(PadSection.docs).sideRow(size)
                    Label("Recordings", systemImage: "mic").tag(PadSection.lectures).sideRow(size)
                    Label("Calendar", systemImage: "calendar").tag(PadSection.calendar).sideRow(size)
                    Label("Integrations", systemImage: "link").tag(PadSection.integrations).sideRow(size)
                }
                if !folders.isEmpty {
                    Section {
                        ForEach(folders, id: \.self) { f in Label(f, systemImage: "folder").tag(PadSection.folder(f)).sideRow(size).folderActions(f) { router.open($0) } }
                    } header: { Text("Folders").sectionTitle() }
                }
            }
            .listStyle(.sidebar)
            .paper()
            .navigationTitle("Monolith")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Settings")
                }
                if size == .compact { ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { create(.doc) } label: { Text("Doc"); Image(systemName: "doc.text") }
                        Button { create(.lecture) } label: { Text("Record"); Image(systemName: "mic") }.disabled(recorder.isRecording)
                        Button { router.newTask() } label: { Text("Task"); Image(systemName: "checklist") }
                        Button { newEvent = true } label: { Text("Event"); Image(systemName: "calendar.badge.plus") }
                    } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Create")
                } }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 300)
        } content: {
            Group {
                switch section ?? .today {
                case .today: TodayView()
                case .tasks: TasksScreen()
                case .folder(let f): DocsView(folder: f)
                case .lectures: ItemListView(kind: .lecture)
                case .docs: DocsView()
                case .calendar: CalendarScreen()
                case .search: SearchView()
                case .integrations: IntegrationsView()
                }
            }
            .id(section)
            .navigationSplitViewColumnWidth(min: 300, ideal: 360, max: 460)
        } detail: {
            if let selection, selection.deletedAt == nil {
                NavigationStack { ItemDetail(item: selection) }.id(selection.id)
            } else if section == .calendar {
                WeekGrid()
            } else {
                EmptyState(symbol: "square.and.pencil", title: "Nothing open", message: "Pick something from the list, or press ⌘N for a new doc.")
            }
        }
        .environment(\.openItem, ItemOpener { item in withAnimation(.snappy) { selection = item; compactColumn = .detail } })
        .environment(\.selectedItemID, selection?.id)
        .onChange(of: section) { if section != .search { selection = nil } }
        .onChange(of: router.calendarDay) { if router.calendarDay != nil { section = .calendar } }
        .onChange(of: router.showTasks) { if router.showTasks { router.showTasks = false; section = .tasks } }
        .onChange(of: router.showSection) { if let s = router.showSection { router.showSection = nil; section = s } }
        // "Open this" from anywhere (quick capture, a new recording, a notification): go to its section and select it.
        .task(id: router.pending?.id) {
            guard let item = router.pending else { return }
            router.pending = nil
            section = item.kind == .lecture ? .lectures : .docs
            DispatchQueue.main.async { selection = item; compactColumn = .detail }
        }
        .sheet(isPresented: $newEvent) { EventEditor(event: nil) }
        .sheet(isPresented: $showDeleted) { DeletedView() }
        .sheet(isPresented: $showSettings) { SettingsSheet() }
        .focusedSceneValue(\.creator, Creator(create: create, newEvent: { newEvent = true }, search: { section = .search }))
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
            if case .folder(let f) = section { item.folder = f }
        }
        ctx.insert(item)
        if section == .today || section == .calendar || section == .search {
            section = kind == .lecture ? .lectures : .docs
        }
        // Select after the list for the new section has appeared.
        DispatchQueue.main.async { selection = item; compactColumn = .detail }
    }
}

extension View {
    /// On iPhone the sidebar is a plain page of rows: no grey cards, no dividers. iPad keeps the system sidebar.
    @ViewBuilder func sideRow(_ size: UserInterfaceSizeClass?) -> some View {
        if size == .compact { listRowBackground(Color.clear).listRowSeparator(.hidden) } else { self }
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

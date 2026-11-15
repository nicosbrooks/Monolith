import SwiftUI
import SwiftData

@main
struct MonolithApp: App {
    @State private var recorder = LectureRecorder()
    @State private var router = Router()
    @State private var link = Linker.shared
    @Environment(\.scenePhase) private var phase

    init() {
        Storage.seedIfEmpty(Storage.container.mainContext)
        Storage.mergeNotesIntoDocs(Storage.container.mainContext)
        Storage.dropBlankDocs(Storage.container.mainContext)
        PhoneLink.shared.start(context: Storage.container.mainContext)
        Linker.shared.start(context: Storage.container.mainContext)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(recorder)
                .environment(router)
                .environment(link)
                .onOpenURL { url in
                    // The Camera app opens monolith://pair links from the QR code on a computer.
                    if let r = PairRequest(url: url) { link.pairState = .confirm; link.request = r }
                }
                .sheet(item: $link.request) { PairSheet(request: $0).environment(link) }
                .onChange(of: phase) {
                    if phase == .active { link.resume() }
                    PhoneLink.shared.sendAgenda()
                }
                .alert("Recording", isPresented: Binding(get: { recorder.error != nil }, set: { if !$0 { recorder.error = nil } })) {
                    if recorder.error?.hasPrefix("Microphone access is off") == true {
                        Button("Open Settings") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) }
                        Button("Not now", role: .cancel) {}
                    } else { Button("OK") {} }
                } message: { Text(recorder.error ?? "") }
                .tint(.primary) // monochrome; accents only where they mean something
        }
        .modelContainer(Storage.container)
        .commands { CreateCommands() }
    }
}

struct RootView: View {
    @AppStorage("appearance") private var appearance = "dark"
    @Environment(\.horizontalSizeClass) private var width
    var body: some View {
        // iPhone: one screen at a time, with the sections in a drawer. iPad and wide windows: the split view.
        Group { if width == .compact { PhoneRoot() } else { PadRoot().bottomBar() } }
            .preferredColorScheme(appearance == "light" ? .light : appearance == "system" ? nil : .dark)
    }
}

extension View {
    /// The one bar at the bottom of every screen: the chat field, with the live recording above it while one runs.
    func bottomBar() -> some View { modifier(BottomBar()) }
}

private struct BottomBar: ViewModifier {
    @Environment(LectureRecorder.self) private var recorder
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @FocusState private var focused: Bool
    @State private var text = ""
    @State private var chat: ChatStart?
    @State private var keyboard = false

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                // Typing in a note or doc: the bar steps aside so the keyboard toolbar has the room.
                if !keyboard || focused || recorder.isRecording {
                    VStack(spacing: 8) {
                        if recorder.isRecording {
                            RecordingAccessory()
                                .frame(maxWidth: 420, minHeight: 50)
                                .glassEffect(.regular, in: .capsule)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                        if let t = Toaster.shared.current {
                            ToastView(toast: t).id(t.id)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                        if !keyboard || focused {
                            ChatField(text: $text, focused: $focused,
                                      prompt: placeholder, send: send) {
                                if !focused { newMenu }
                            }
                        }
                    }
                    .padding(.horizontal, 14).padding(.top, 28).padding(.bottom, 8)
                    .background(Fog())
                }
            }
            .animation(.snappy, value: recorder.isRecording)
            .animation(.snappy, value: Toaster.shared.current?.id)
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboard = true }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboard = false }
            .sheet(item: $chat) { ChatView(first: $0.text, about: $0.about) }
    }

    /// One place to start something new, like ChatGPT's +.
    private var newMenu: some View {
        Menu {
            // The web's create sheet: Doc, Record, Event, each with its one-line hint.
            Button { create(.doc) } label: { Text("Doc"); Text("Notes, checklists, long-form writing"); Image(systemName: "doc.text") }
            Button { record() } label: { Text("Record"); Text("A class, a meeting, a thought"); Image(systemName: "mic") }
                .disabled(recorder.isRecording)
            Button { router.createEvent() } label: { Text("Event"); Text("Add to your calendar"); Image(systemName: "calendar.badge.plus") }
        } label: {
            Image(systemName: "plus").font(.title3.weight(.medium)).foregroundStyle(.primary)
                .frame(width: 48, height: 48)
                .glassEffect(.regular, in: .circle)
        }
        .accessibilityLabel("New")
    }

    /// Like the web: a new recording is named for today and starts right away.
    private func record() {
        let l = Item(.lecture, title: "Recording · \(Date.now.formatted(.dateTime.month(.abbreviated).day()))")
        ctx.insert(l)
        router.open(l)
        recorder.start(l)
    }

    private func create(_ kind: ItemKind) {
        let item = Item(kind)
        ctx.insert(item)
        router.open(item)
    }

    private func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        focused = false
        text = ""
        // On the calendar, "calc review thu 4pm" is an event; a question still goes to chat.
        if router.onCalendar, !Self.isQuestion(t), let p = QuickAdd.parse(t) {
            let e = Event(title: p.title, start: p.start, end: p.end)
            ctx.insert(e)
            PhoneLink.shared.sendAgenda()
            router.openCalendar(p.start)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            Toaster.shared.show("Added \(e.title)", detail: e.start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()),
                                action: ("Undo", { [ctx] in ctx.delete(e); PhoneLink.shared.sendAgenda() }))
            return
        }
        chat = ChatStart(text: t, about: router.reading)
    }

    /// Says what the bar will do here, like the web app's "Ask about “Study system”".
    private var placeholder: String {
        if router.onCalendar { return "Add an event or ask" }
        if let d = router.reading { return "Ask about \u{201C}\(d.displayTitle)\u{201D}" }
        return "Ask Monolith"
    }

    private static let questionWords: Set<String> = ["what", "when", "where", "who", "why", "how", "do", "does", "did", "is", "are", "am", "can", "could", "should", "will", "would", "which", "any", "show", "list", "find", "tell", "summarize", "explain"]
    static func isQuestion(_ t: String) -> Bool {
        if t.contains("?") { return true }
        let first = t.lowercased().split(whereSeparator: { !$0.isLetter }).first.map(String.init) ?? ""
        return questionWords.contains(first)
    }
}

private struct ChatStart: Identifiable {
    let id = UUID()
    var text: String
    var about: Item?
}

/// What to open next, from anywhere: a new item, or a day in the calendar.
@Observable
final class Router {
    var pending: Item?
    var calendarDay: Date?
    /// True while the calendar is on screen: the bottom bar then adds events as well as answering.
    var onCalendar = false
    /// Set to open the new-event form on the calendar.
    var newEvent = false
    /// The doc on screen, if any: the bottom bar asks about it.
    var reading: Item?

    func open(_ item: Item) {
        pending = item
    }

    func openCalendar(_ day: Date) {
        calendarDay = day
    }

    func createEvent() {
        if !onCalendar { calendarDay = .now }
        newEvent = true
    }
}

extension View {
    /// Opens `router.pending` in this stack when it's this tab's kind.
    func opensPending(_ kind: ItemKind, path: Binding<[Item]>) -> some View {
        modifier(OpensPending(kind: kind, path: path))
    }
}

private struct OpensPending: ViewModifier {
    var kind: ItemKind
    @Binding var path: [Item]
    @Environment(Router.self) private var router
    @Environment(\.openItem) private var openItem
    func body(content: Content) -> some View {
        content.task(id: router.pending?.id) {
            // In the split view the root opens it in the editor column instead.
            guard openItem == nil, let p = router.pending, p.kind == kind else { return }
            path = [p]
            router.pending = nil
        }
    }
}

struct RecordingAccessory: View {
    @Environment(LectureRecorder.self) private var recorder
    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(.red).frame(width: 8, height: 8)
                .phaseAnimator([1.0, 0.35]) { c, o in c.opacity(o) } animation: { _ in .easeInOut(duration: 0.8) }
            Text(recorder.item?.displayTitle ?? "Recording")
                .font(.subheadline.weight(.semibold)).lineLimit(1)
            Spacer()
            Text(recorder.elapsed.clock).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            Button { recorder.stop() } label: { Image(systemName: "stop.fill") }
                .foregroundStyle(.red)
                .accessibilityLabel("Stop recording")
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - iPhone root

extension EnvironmentValues {
    /// Set on iPhone: opens the section drawer. Each section's first screen shows a menu button for it.
    @Entry var openDrawer: (() -> Void)? = nil
}

extension View {
    /// The menu button on a section's first screen (iPhone only).
    func drawerButton() -> some View { modifier(DrawerButton()) }
}

private struct DrawerButton: ViewModifier {
    @Environment(\.openDrawer) private var open
    func body(content: Content) -> some View {
        content.toolbar {
            if let open {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: open) { Image(systemName: "sidebar.left") }.accessibilityLabel("Menu")
                }
            }
        }
    }
}

/// iPhone: Home is the base screen; the sections live in a drawer that slides over part of it.
struct PhoneRoot: View {
    @Environment(Router.self) private var router
    @Environment(\.modelContext) private var ctx
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }) private var items: [Item]
    @State private var section: PadSection = .today
    @State private var drawer = false
    @State private var settings = false
    @State private var allRecents = false

    private var folders: [String] { Array(Set(items.compactMap(\.folder))).sorted() }

    var body: some View {
        // A sidebar that sits beside the page: opening it slides the page over, the page stays in view.
        GeometryReader { geo in
            let w = min(290, geo.size.width * 0.78)
            ZStack(alignment: .leading) {
                menu
                    .frame(width: w)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .background(Theme.paper.ignoresSafeArea())
                    .opacity(drawer ? 1 : 0)
                screen
                    .id(section)
                    .bottomBar()  // moves with the page, so it never sits over the sidebar
                    .background(Theme.paper.ignoresSafeArea())
                    .environment(\.openDrawer, { withAnimation(.snappy) { drawer = true } })
                    .overlay {
                        if drawer {
                            Color.black.opacity(0.25).ignoresSafeArea()
                                .onTapGesture { close() }
                                .transition(.opacity)
                        }
                    }
                    .overlay(alignment: .leading) {
                        // Swipe in from the left edge to open, like the system back gesture.
                        if !drawer {
                            Color.clear.frame(width: 16).contentShape(.rect).ignoresSafeArea()
                                .gesture(DragGesture(minimumDistance: 10).onEnded { if $0.translation.width > 40 { withAnimation(.snappy) { drawer = true } } })
                        }
                    }
                    // Sidebar and page share the same black, so a hairline marks the page edge.
                    .overlay(alignment: .leading) { if drawer { Theme.rule.frame(width: 1).ignoresSafeArea() } }
                    .offset(x: drawer ? w : 0)
                    .gesture(drawer ? DragGesture().onEnded { if $0.translation.width < -40 { close() } } : nil)
            }
        }
        .onChange(of: router.calendarDay) { if router.calendarDay != nil { section = .calendar } }
        // Something new to open: go to its list, which pushes it (see `opensPending`).
        .onChange(of: router.pending?.id) {
            guard let p = router.pending else { return }
            section = p.kind == .lecture ? .lectures : .docs
        }
        .sheet(isPresented: $settings) { SettingsSheet() }
        .sheet(isPresented: $allRecents) {
            NavigationStack {
                AllRecentsView { item in allRecents = false; close(); router.open(item) }
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { allRecents = false } } }
            }
            .presentationDetents([.medium, .large])
        }
    }

    @ViewBuilder private var screen: some View {
        switch section {
        case .today: TodayView()
        case .folder(let f): DocsView(folder: f)
        case .lectures: ItemListView(kind: .lecture)
        case .docs: DocsView()
        case .calendar: CalendarScreen()
        case .search: SearchView()
        }
    }

    private var recents: [Item] { Array(items.sorted { $0.updatedAt > $1.updatedAt }.prefix(6)) }

    private var menu: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Monolith").font(.title3.weight(.semibold))
                    Spacer()
                    HStack(spacing: 0) {
                        Button { section = .search; close() } label: { Image(systemName: "magnifyingglass").frame(width: 44, height: 40) }
                            .accessibilityLabel("Search")
                        Button { close(); settings = true } label: { Image(systemName: "gearshape").frame(width: 44, height: 40) }
                            .accessibilityLabel("Settings")
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular, in: .capsule)
                }
                .padding(.leading, 12).padding(.bottom, 14)
                row("Home", "square.grid.2x2", .today)
                row("Docs", "doc.text", .docs)
                row("Recordings", "mic", .lectures)
                row("Calendar", "calendar", .calendar)
                if !folders.isEmpty {
                    heading("Folders")
                    ForEach(folders, id: \.self) { f in row(f, "folder", .folder(f)).folderActions(f) { router.open($0); close() } }
                }
                if !recents.isEmpty {
                    heading("Recents")
                    ForEach(recents.prefix(5)) { item in
                        Button { router.open(item); close() } label: {
                            Text(item.displayTitle).lineLimit(1)
                                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                                .padding(.horizontal, 12)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .contextMenu { ItemMenu(item: item) }
                    }
                    if recents.count > 5 {
                        Button { allRecents = true } label: {
                            Label("See all", systemImage: "clock").foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                                .padding(.horizontal, 12).contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .padding(.bottom, 90)
        }
        .scrollIndicators(.hidden)
        .overlay(alignment: .bottomTrailing) {
            Button { let n = Item(.doc); ctx.insert(n); router.open(n); close() } label: {
                Label("New doc", systemImage: "square.and.pencil").font(.body.weight(.semibold))
                    .padding(.horizontal, 20).frame(height: 50)
                    .foregroundStyle(Theme.paper)
                    .background(Color.primary, in: .capsule)
            }
            .buttonStyle(.plain)
            .padding(.trailing, 16).padding(.bottom, 12)
        }
    }

    private func heading(_ t: String) -> some View {
        Text(t).font(.headline).padding(.leading, 12).padding(.top, 24).padding(.bottom, 6)
    }

    private func row(_ title: String, _ symbol: String, _ s: PadSection) -> some View {
        Button { section = s; close() } label: {
            Label(title, systemImage: symbol)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 12)
                .background(section == s ? Theme.wash : .clear, in: .rect(cornerRadius: 12))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func close() { withAnimation(.snappy) { drawer = false } }
}

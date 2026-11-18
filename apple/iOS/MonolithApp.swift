import SwiftUI
import SwiftData

@main
struct MonolithApp: App {
    @State private var recorder = LectureRecorder()
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var router = Router.shared
    @State private var link = Linker.shared
    @Environment(\.scenePhase) private var phase

    init() {
        Profile.markExistingInstall(hasItems: ((try? Storage.container.mainContext.fetchCount(FetchDescriptor<Item>())) ?? 0) > 0)
        Storage.seedIfEmpty(Storage.container.mainContext)
        Storage.mergeNotesIntoDocs(Storage.container.mainContext)
        Storage.dropBlankDocs(Storage.container.mainContext)
        Todos.moveInboxDoc(Storage.container.mainContext)
        Todos.pruneDone(Storage.container.mainContext)
        PhoneLink.shared.start(context: Storage.container.mainContext)
        Linker.shared.start(context: Storage.container.mainContext)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .handlesSystemActions()
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
                .lookTint() // the accent chosen in Settings › Appearance (DESIGN.md › Looks and accent)
        }
        .modelContainer(Storage.container)
        .commands { CreateCommands() }
    }
}

struct RootView: View {
    @AppStorage("appearance") private var appearance = "dark"
    @AppStorage(Profile.setupAt) private var setupAt = 0.0
    @Environment(\.horizontalSizeClass) private var width
    @Environment(\.scenePhase) private var phase
    @State private var lock = AppLock.shared
    var body: some View {
        // iPhone: one screen at a time, with the sections in a drawer. iPad and wide windows: the split view.
        Group {
            if setupAt == 0 { SetupView().transition(.opacity) }
            else if width == .compact { PhoneRoot() } else { PadRoot() }
        }
        .animation(.easeOut(duration: 0.25), value: setupAt == 0)
            // With the lock on, nothing shows until it's opened, including in the app switcher.
            .overlay { if lock.enabled && (lock.locked || phase != .active) { LockScreen().transition(.opacity) } }
            .animation(.easeOut(duration: 0.2), value: lock.locked)
            .onChange(of: phase) { if phase == .background { lock.lockIfEnabled() } }
            .preferredColorScheme(appearance == "light" ? .light : appearance == "system" ? nil : .dark)
    }
}

// MARK: - Places

/// Where you can be: the four tabs, and Ask. Folders are chips inside Docs.
enum PadSection: Hashable {
    case today, tasks, docs, calendar, ask
}

/// What to open next, from anywhere: a new item, or a day in the calendar.
@Observable
final class Router {
    /// One per app, so Siri, quick actions and Spotlight can reach it from outside the views.
    static let shared = Router()
    /// Waiting to be done once the app is on screen (SystemActions.swift).
    var action: SystemAction?
    /// Go to Ask with the cursor in it (the "Ask" quick action).
    var focusAsk = false
    var pending: Item?
    var calendarDay: Date?
    /// Set to go to Tasks (the + menu's Task, Siri, a notification).
    var showTasks = false
    /// Put the cursor in Tasks' new-task row once it's on screen.
    var typeTask = false
    /// Set to go to a place (Docs after a folder is made, renamed or deleted).
    var showSection: PadSection?
    /// Set to open the new-event form on the calendar.
    var newEvent = false
    /// The doc on screen, if any: Ask offers to ask about it.
    var reading: Item?
    /// Set to open chat with this question already sent (Ask's starting points, Siri).
    var ask: String?
    var askAbout: Item?

    func open(_ item: Item) { pending = item }
    func openCalendar(_ day: Date) { calendarDay = day }

    /// Go to Tasks with the new-task row ready to type in.
    func newTask() {
        showTasks = true
        typeTask = true
    }

    func createEvent() {
        showSection = .calendar
        newEvent = true
    }

    /// Opens chat with a question, optionally about a doc.
    func ask(question q: String, about: Item? = nil) {
        askAbout = about
        ask = q
    }
}

/// One place to start something new: the + on Home and in the iPad sidebar.
struct NewMenu<Label: View>: View {
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @Environment(LectureRecorder.self) private var recorder
    @ViewBuilder var label: Label

    var body: some View {
        Menu {
            Button { let d = Item(.doc); ctx.insert(d); router.open(d) } label: { Text("Doc"); Image(systemName: "doc.text") }
            Button { record() } label: { Text("Recording"); Image(systemName: "mic") }
                .disabled(recorder.isRecording)
            Button { router.newTask() } label: { Text("Task"); Image(systemName: "checklist") }
            Button { router.createEvent() } label: { Text("Event"); Image(systemName: "calendar.badge.plus") }
        } label: { label }
        .accessibilityLabel("New")
    }

    /// Like the web: a new recording is named for today and starts right away.
    private func record() {
        let l = Item(.lecture, title: "Recording · \(Date.now.formatted(.dateTime.month(.abbreviated).day()))")
        ctx.insert(l)
        router.open(l)
        recorder.start(l)
    }
}

struct RecordingAccessory: View {
    @Environment(LectureRecorder.self) private var recorder
    @Environment(Router.self) private var router
    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(.red).frame(width: 8, height: 8)
                .phaseAnimator([1.0, 0.35]) { c, o in c.opacity(o) } animation: { _ in .easeInOut(duration: 0.8) }
            Button { if let i = recorder.item { router.open(i) } } label: {
                Text(recorder.item?.displayTitle ?? "Recording")
                    .font(.subheadline.weight(.semibold)).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            Text(recorder.elapsed.clock).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            Button { recorder.stop() } label: { Image(systemName: "stop.fill").frame(width: 32, height: 32) }
                .foregroundStyle(.red)
                .accessibilityLabel("Stop recording")
        }
        .padding(.horizontal, 16)
    }
}

/// Notifications: one at a time, rising just above the tab bar (iPhone) or the bottom edge (iPad).
struct Toasts: ViewModifier {
    var bottom: CGFloat
    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let t = Toaster.shared.current {
                    ToastView(toast: t).id(t.id)
                        .padding(.horizontal, 14).padding(.bottom, bottom)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: Toaster.shared.current?.id)
    }
}

/// Chat opened from anywhere (`router.ask`), and the routes every root follows.
struct Routes: ViewModifier {
    @Binding var section: PadSection
    /// iPad has an Ask place; on iPhone the Ask field lives on Home.
    var askPlace: PadSection = .ask
    @Environment(Router.self) private var router
    @State private var chat: ChatStart?

    func body(content: Content) -> some View {
        content
            .onChange(of: router.calendarDay) { if router.calendarDay != nil { section = .calendar } }
            .onChange(of: router.showTasks) { if router.showTasks { router.showTasks = false; section = .tasks } }
            .onChange(of: router.showSection) { if let s = router.showSection { router.showSection = nil; section = s } }
            .onChange(of: router.focusAsk) { if router.focusAsk { section = askPlace } }
            // Something to open: Docs pushes it (see DocsView), wherever you were.
            .onChange(of: router.pending?.id) { if router.pending != nil { section = .docs } }
            .onChange(of: router.ask) {
                guard let q = router.ask else { return }
                router.ask = nil
                chat = ChatStart(text: q, about: router.askAbout)
                router.askAbout = nil
            }
            .sheet(item: $chat) { ChatView(first: $0.text, about: $0.about) }
    }
}

private struct ChatStart: Identifiable {
    let id = UUID()
    var text: String
    var about: Item?
}

// MARK: - iPhone root

extension EnvironmentValues {
    /// Set on iPhone: slides the drawer open. Each tab's first screen shows ☰ for it.
    @Entry var openDrawer: (() -> Void)? = nil
}

extension View {
    /// ☰ at the top left of a tab's first screen (iPhone only).
    func drawerButton() -> some View { modifier(DrawerButton()) }
}

private struct DrawerButton: ViewModifier {
    @Environment(\.openDrawer) private var open
    func body(content: Content) -> some View {
        content.toolbar {
            if let open {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: open) { Image(systemName: "line.3.horizontal") }.accessibilityLabel("Menu")
                }
            }
        }
    }
}

/// iPhone: four tabs at the bottom (Home, Tasks, Docs, Calendar) and a drawer behind the page for what you were just
/// in, your folders and the rest. ☰ or a swipe from the left edge slides the page aside to show it.
struct PhoneRoot: View {
    @Environment(LectureRecorder.self) private var recorder
    @State private var section: PadSection = .today
    @State private var drawer = false
    @GestureState private var drag: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let w = min(330, geo.size.width * 0.82)
            let shift = drawer ? max(0, w + min(0, drag)) : max(0, min(w, drag))
            ZStack(alignment: .leading) {
                Drawer(section: $section, close: close)
                    .frame(width: w)
                    .frame(maxHeight: .infinity)
                    .opacity(Double(shift / w))
                tabs
                    .clipShape(.rect(cornerRadius: shift > 0 ? 44 : 0, style: .continuous))
                    .overlay {
                        if shift > 0 {
                            RoundedRectangle(cornerRadius: 44, style: .continuous).strokeBorder(Color.primary.opacity(0.1))
                                .ignoresSafeArea()
                            Color.black.opacity(0.001).ignoresSafeArea().onTapGesture(perform: close)
                        }
                    }
                    .offset(x: shift)
                    .overlay(alignment: .leading) {
                        // Swipe in from the left edge to open, like Back.
                        if !drawer { Color.clear.frame(width: 18).contentShape(.rect).ignoresSafeArea().gesture(edgeDrag) }
                    }
                    .gesture(drawer ? edgeDrag : nil)
                    .ignoresSafeArea(.container, edges: shift > 0 ? .vertical : [])
            }
            .background { Wash() }
        }
        .environment(\.openDrawer, { open() })
        .modifier(Routes(section: $section, askPlace: .today))
        .onChange(of: section) { close() }
    }

    private var tabs: some View {
        TabView(selection: $section) {
            Tab("Home", systemImage: "house", value: PadSection.today) { TodayView() }
            Tab("Tasks", systemImage: "checklist", value: PadSection.tasks) { TasksScreen() }
            Tab("Docs", systemImage: "doc.text", value: PadSection.docs) { DocsView() }
            Tab("Calendar", systemImage: "calendar", value: PadSection.calendar) { CalendarScreen() }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory(isEnabled: recorder.isRecording) { RecordingAccessory() }
        .onChange(of: section) { Haptics.tap() }
        .modifier(Toasts(bottom: recorder.isRecording ? 130 : 80))
    }

    private var edgeDrag: some Gesture {
        DragGesture(minimumDistance: 12)
            .updating($drag) { v, s, _ in s = v.translation.width }
            .onEnded { v in
                withAnimation(.snappy) { drawer = drawer ? v.translation.width > -60 : v.translation.width > 60 }
            }
    }

    private func open() { Haptics.tap(); withAnimation(.snappy) { drawer = true } }
    private func close() { withAnimation(.snappy) { drawer = false } }
}

/// The drawer: Search, Recents (docs and recordings you were just in), Folders, More, and at the foot your initials
/// (Settings) and New doc.
private struct Drawer: View {
    @Binding var section: PadSection
    var close: () -> Void
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    @AppStorage(Folders.key) private var emptyFolders = ""
    @AppStorage(Profile.name) private var name = ""
    @State private var settings = false
    @State private var search = false
    @State private var deleted = false

    private var folders: [String] { Folders.all(items, emptyFolders) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Monolith").font(.system(size: 30, weight: .bold)).tracking(-0.5)
                Spacer()
                Button { search = true } label: {
                    Image(systemName: "magnifyingglass").font(.title3.weight(.medium)).frame(width: 50, height: 50)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Search and ask")
            }
            .padding(.horizontal, 24).padding(.top, 8).padding(.bottom, 18)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if !items.isEmpty {
                        HStack {
                            heading("Recents")
                            Spacer()
                            Button { DocsView.show(folder: nil); go(.docs) } label: {
                                HStack(spacing: 4) { Text("View all"); Image(systemName: "chevron.right").font(.footnote.weight(.semibold)) }
                            }
                            .buttonStyle(.plain).foregroundStyle(.primary).font(.subheadline)
                        }
                        ForEach(items.prefix(8)) { item in
                            row(item.displayTitle, item.kind == .lecture ? "waveform" : "doc.text") { router.open(item); close() }
                                .itemMenu(item, folders: folders)
                        }
                    }
                    if !folders.isEmpty {
                        heading("Folders").padding(.top, 22)
                        ForEach(folders, id: \.self) { f in
                            row(f, "folder") { DocsView.show(folder: f); go(.docs) }
                                .folderActions(f) { router.open($0); close() }
                        }
                    }
                    heading("More").padding(.top, 22)
                    row("Recently Deleted", "trash") { deleted = true }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 120)
            }
            .scrollIndicators(.hidden)
        }
        .overlay(alignment: .bottom) { foot }
        .sheet(isPresented: $settings) { SettingsSheet() }
        .sheet(isPresented: $search) { AskScreen(sheet: true) }
        .sheet(isPresented: $deleted) { DeletedView() }
    }

    private var foot: some View {
        HStack {
            Button { settings = true } label: {
                Text(initials).font(.headline).frame(width: 56, height: 56)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Settings")
            Spacer()
            Button { let d = Item(.doc); ctx.insert(d); router.open(d); close() } label: {
                Label("New doc", systemImage: "plus").font(.body.weight(.semibold))
                    .padding(.horizontal, 22).frame(height: 56)
                    .foregroundStyle(Theme.paper)
                    .background(Color.primary, in: .capsule)
            }
            .buttonStyle(.card)
        }
        .padding(.horizontal, 24).padding(.bottom, 8)
    }

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2).compactMap(\.first)
        return parts.isEmpty ? "Me" : String(parts).uppercased()
    }

    private func heading(_ t: String) -> some View {
        Text(t).font(.subheadline).foregroundStyle(.secondary).frame(minHeight: 40, alignment: .leading)
    }

    private func row(_ title: String, _ symbol: String, run: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); run() } label: {
            HStack(spacing: 16) {
                Image(systemName: symbol).font(.body).foregroundStyle(.secondary).frame(width: 24)
                Text(title).font(.body).lineLimit(1)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 50).contentShape(.rect)
        }
        .buttonStyle(.row)
    }

    private func go(_ s: PadSection) { section = s; close() }
}

import SwiftUI
import SwiftData

/// Schedule, open tasks (tasks of their own, not lines in docs), and recent work above the floating Ask bar.
struct TodayView: View {
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    @Query(sort: \Event.start) private var events: [Event]
    @Query private var todos: [Todo]
    @State private var path: [Item] = []
    /// Dismissed and accepted suggestions, kept across launches so nothing is offered twice.
    @AppStorage("dismissedSuggestions") private var dismissedRaw = ""
    @AppStorage(Profile.name) private var userName = ""
    @AppStorage(Profile.setupAt) private var setupAt = 0.0
    @State private var away = Greeting.away()
    private var dismissed: Set<String> { Set(dismissedRaw.split(separator: "\n").map(String.init)) }
    private func dismiss(_ id: String) {
        // Keep the newest 500, oldest dropped first.
        let kept = (dismissedRaw.split(separator: "\n").map(String.init).filter { $0 != id } + [id]).suffix(500)
        withAnimation { dismissedRaw = kept.joined(separator: "\n"); rederive() }
    }
    private func undismiss(_ id: String) {
        withAnimation { dismissedRaw = dismissedRaw.split(separator: "\n").map(String.init).filter { $0 != id }.joined(separator: "\n"); rederive() }
    }
    @Environment(\.horizontalSizeClass) private var size
    private var compact: Bool { size == .compact }
    private var integrations: Integrations { .shared }
    /// Derived lists, rebuilt shortly after notes or events change rather than on every redraw:
    /// scanning notes for dates and tasks is the costliest thing this screen does.
    private struct Derived {
        var todays: [AgendaItem] = []
        var tasks: [Todo] = []
        var taskCount = 0
        var nudge: Suggestion?
    }
    @State private var derived = Derived()
    @State private var derivedOnce = false
    private var todays: [AgendaItem] { derived.todays }
    private var tasks: [Todo] { derived.tasks }
    private var nudge: Suggestion? { derived.nudge }
    /// Changes when anything this screen derives from changes.
    private var stamp: String {
        let ev = events.reduce(0) { $0 ^ $1.start.hashValue ^ $1.end.hashValue ^ $1.title.hashValue }
        return "\(items.count)|\(items.first?.updatedAt.timeIntervalSince1970 ?? 0)|\(events.count)|\(ev)|\(DeviceCalendars.shared.version)|\(todos.count)|\(todos.map(\.updatedAt).max()?.timeIntervalSince1970 ?? 0)|\(dismissedRaw.count)|\(Calendar.current.startOfDay(for: .now).timeIntervalSince1970)"
    }
    private func rederive() {
        let all = allTasks
        derived = Derived(todays: computeTodays, tasks: Array(all.prefix(8)), taskCount: all.count,
                          nudge: Suggestion.dates(in: items.lazy.filter { $0.kind == .doc }.prefix(30), existing: events).first { !dismissed.contains($0.id) })
    }

    private var computeTodays: [AgendaItem] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: .now)
        return agenda(events, from: start, to: calendar.date(byAdding: .day, value: 1, to: start) ?? start)
    }
    private var upcoming: [AgendaItem] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        let start = calendar.date(byAdding: .day, value: 1, to: today) ?? today
        let end = calendar.date(byAdding: .day, value: 7, to: today) ?? start
        return Array(agenda(events, from: start, to: end).filter { $0.start >= start }.prefix(4))
    }
    private var allTasks: [Todo] { Todos.open(todos) }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    greeting
                    // Only once the docs have been read for dates, so the card appears once, in its final form.
                    if derivedOnce, let s = nudge { suggestionCard(s).transition(.opacity) }
                    if !items.isEmpty { recentRow }
                    let layout = compact ? AnyLayout(VStackLayout(spacing: 14)) : AnyLayout(HStackLayout(alignment: .top, spacing: 14))
                    layout {
                        tasksPanel
                        calendarPanel
                    }
                }
                .frame(maxWidth: 960, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Space.page)
                .padding(.top, 4)
                .padding(.bottom, 40)
                .animation(.snappy, value: nudge?.id)
            }
            .paper()
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .drawerButton()
            // iPhone: the Ask field sits above the tabs, with + for something new and the mic to record.
            .safeAreaInset(edge: .bottom, spacing: 0) { if compact { HomeComposer().padding(.horizontal, 14).padding(.bottom, 8) } }
            .navigationDestination(for: Item.self) { ItemDetail(item: $0).navigationTransition(.zoom(sourceID: $0.id, in: zoom)) }
            .task(id: stamp) {
                // Typing changes a note several times a second; wait for a pause before rescanning.
                if derivedOnce { try? await Task.sleep(for: .milliseconds(400)) }
                guard !Task.isCancelled else { return }
                rederive()
                derivedOnce = true
                integrations.upcoming(events.map { ($0.title, $0.location ?? "", $0.start) })
                integrations.refresh()
            }
        }
    }

    @Namespace private var zoom

    /// What's left today, or the next thing coming if today is done.
    private var comingUp: [AgendaItem] {
        let left = todays.filter { $0.allDay || $0.end > .now }
        return Array((left.isEmpty ? upcoming.prefix(1) : left.prefix(3)))
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                .font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            Text(Greeting.text(name: userName, away: away))
                .font(.system(size: 34, weight: .bold)).tracking(-0.6)
                .accessibilityAddTraits(.isHeader)
        }
    }

    /// The docs you were just in, as cards in one row, like the web's Recent.
    private var recentRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Recent").font(.subheadline.weight(.semibold))
                Spacer()
                Button("See all") { DocsView.show(folder: nil); router.showSection = .docs }
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items.prefix(8)) { item in
                        NavigationLink(value: item) { DocCard(item: item).frame(width: compact ? 200 : 240) }
                            .buttonStyle(.card)
                            .matchedTransitionSource(id: item.id, in: zoom)
                            .itemMenu(item)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    private var tasksPanel: some View {
        Panel(title: "Tasks") {
            Button(derived.taskCount > 5 ? "All \(derived.taskCount)" : "Open") { router.showTasks = true }
        } content: {
            if tasks.isEmpty {
                Button { router.newTask() } label: {
                    HStack(spacing: 14) {
                        Image(systemName: "plus").frame(width: 22).foregroundStyle(.tint)
                        Text("Add a task").foregroundStyle(.secondary)
                        Spacer()
                    }
                    .frame(minHeight: Space.row).contentShape(.rect)
                }
                .buttonStyle(.row)
            }
            ForEach(tasks.prefix(5)) { TodoRow(todo: $0) }
        }
    }

    private var calendarPanel: some View {
        let weather = integrations.isOn(.weather) ? integrations.weather : nil
        return Panel(title: "Calendar") {
            HStack(spacing: 6) {
                if let weather {
                    Image(systemName: weather.symbol).symbolRenderingMode(.multicolor)
                    Text(weather.line)
                } else {
                    Button("Open") { router.openCalendar(.now) }
                }
            }
        } content: {
            if comingUp.isEmpty {
                Button { router.createEvent() } label: {
                    HStack(spacing: 14) {
                        Image(systemName: "plus").frame(width: 22).foregroundStyle(.tint)
                        Text("Nothing coming up. Add an event").foregroundStyle(.secondary)
                        Spacer()
                    }
                    .frame(minHeight: Space.row).contentShape(.rect)
                }
                .buttonStyle(.row)
            }
            ForEach(comingUp) { e in
                Button { router.openCalendar(e.start) } label: { eventRow(e) }
                    .buttonStyle(.row)
            }
            // Maps: when to leave for the next event that has a place.
            if integrations.isOn(.maps), let t = integrations.trip {
                Button { router.openCalendar(t.start) } label: {
                    HStack(spacing: 14) {
                        Image(systemName: t.walking ? "figure.walk" : "car").font(.subheadline).foregroundStyle(.secondary).frame(width: 22)
                        Text("Leave by \(t.leaveBy.formatted(date: .omitted, time: .shortened))").foregroundStyle(.secondary)
                        Spacer(minLength: 8)
                        Text(t.line).font(.footnote).foregroundStyle(.secondary)
                    }
                    .frame(minHeight: Space.row).contentShape(.rect)
                }
                .buttonStyle(.row)
            }
        }
    }

    /// A date the assistant found in a doc: what, when, exactly where it came from, and two clear choices.
    private func suggestionCard(_ s: Suggestion) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Add to your calendar?").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text(s.title).font(.title3.weight(.semibold))
                Text(s.date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day().hour().minute()))
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if let doc = items.first(where: { $0.id == s.itemID }) {
                NavigationLink(value: doc) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(systemName: "doc.text").imageScale(.small)
                        (Text(doc.displayTitle).foregroundStyle(.primary) + Text("  \u{201C}\(s.line)\u{201D}"))
                            .lineLimit(2).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .font(.footnote).foregroundStyle(.secondary)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the doc")
            }
            HStack(spacing: 8) {
                Button { add(s) } label: { Text("Add to calendar").font(.subheadline.weight(.semibold)).padding(.horizontal, 6) }
                    .buttonStyle(.glassProminent)
                Button { dismiss(s.id); Toaster.shared.show("Suggestion hidden", action: ("Undo", { undismiss(s.id) })) } label: {
                    Text("Not now").font(.subheadline.weight(.semibold)).padding(.horizontal, 6)
                }
                .buttonStyle(.glass)
            }
        }
        .padding(Space.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel(radius: 24)
    }

    /// An event on Home: a colored bar, title with its place underneath, start and end on the right.
    private func eventRow(_ e: AgendaItem) -> some View {
        let place = e.location?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmptyOrNil
        let day = Calendar.current.isDateInToday(e.start) ? nil : e.start.formatted(.dateTime.weekday(.abbreviated))
        let detail = [day, place].compactMap { $0 }.joined(separator: " · ")
        return HStack(alignment: .center, spacing: 14) {
            RoundedRectangle(cornerRadius: 2).fill(e.color)
                .frame(width: 4).frame(maxHeight: .infinity).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.title).lineLimit(1)
                if !detail.isEmpty {
                    HStack(spacing: 4) {
                        if place != nil { Image(systemName: "mappin").imageScale(.small) }
                        Text(detail).lineLimit(1)
                    }
                    .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                if e.allDay {
                    Text("All day")
                } else {
                    Text(e.start.formatted(date: .omitted, time: .shortened)).foregroundStyle(.primary)
                    Text(e.end.formatted(date: .omitted, time: .shortened))
                }
            }
            .font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 8)
        .frame(minHeight: Space.row).contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    private func add(_ s: Suggestion) {
        let e = Event(title: s.title, start: s.date, end: s.date.addingTimeInterval(3600))
        ctx.insert(e)
        PhoneLink.shared.sendAgenda()
        dismiss(s.id)
        Toaster.shared.show("Added to calendar", detail: s.date.formatted(.dateTime.weekday(.wide).hour().minute()),
                            action: ("Undo", { [ctx] in ctx.delete(e); PhoneLink.shared.sendAgenda(); undismiss(s.id) }))
    }
}

private extension String {
    var nonEmptyOrNil: String? { isEmpty ? nil : self }
}

/// Home's field above the tabs: + (Doc, Recording, Task, Event), "Ask or search", and the mic to start recording.
/// Once something's typed the mic becomes Send, which asks the assistant.
private struct HomeComposer: View {
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @Environment(LectureRecorder.self) private var recorder
    @State private var text = ""
    @FocusState private var focused: Bool
    private var empty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        HStack(spacing: 8) {
            NewMenu {
                Image(systemName: "plus").font(.title3.weight(.medium)).foregroundStyle(.primary)
                    .frame(width: 44, height: 44)
                    .background(Color.primary.opacity(0.08), in: .circle)
            }
            TextField("Ask or search", text: $text, axis: .vertical)
                .lineLimit(1...5)
                .focused($focused)
                .submitLabel(.send)
                .onSubmit(send)
                .padding(.vertical, 12)
            Button { empty ? record() : send() } label: {
                Image(systemName: empty ? "mic.fill" : "arrow.up").font(.body.weight(.semibold))
                    .frame(width: 44, height: 44)
                    .foregroundStyle(empty ? AnyShapeStyle(.primary) : AnyShapeStyle(Theme.paper))
                    .background(empty ? AnyShapeStyle(Color.primary.opacity(0.08)) : AnyShapeStyle(.tint), in: .circle)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)
            .disabled(empty && recorder.isRecording)
            .accessibilityLabel(empty ? "Record" : "Ask")
        }
        .padding(6)
        .glassEffect(.regular, in: .rect(cornerRadius: 28, style: .continuous))
        .animation(.snappy(duration: 0.2), value: empty)
        .onChange(of: focused) { if focused { Assistant.warm() } }
        .onAppear { if router.focusAsk { router.focusAsk = false; focused = true } }
        .onChange(of: router.focusAsk) { if router.focusAsk { router.focusAsk = false; focused = true } }
    }

    private func send() {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        text = ""
        focused = false
        router.ask(question: q)
    }

    /// Like the web: a new recording is named for today and starts right away.
    private func record() {
        let l = Item(.lecture, title: "Recording · \(Date.now.formatted(.dateTime.month(.abbreviated).day()))")
        ctx.insert(l)
        recorder.start(l)
        router.open(l)
        Haptics.success()
    }
}

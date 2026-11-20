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
                    // What's happening right now, or next: changes through the day, gone when there's nothing.
                    TimelineView(.everyMinute) { ctx in nowCard(ctx.date) }
                    // Only once the docs have been read for dates, so the card appears once, in its final form.
                    if derivedOnce, let s = nudge { suggestionCard(s).transition(.opacity) }
                    sections
                    if !hidden.isEmpty { hiddenRow }
                }
                .animation(.snappy, value: orderRaw)
                .animation(.snappy, value: hiddenRaw)
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
    @Environment(LectureRecorder.self) private var recorder

    // MARK: Arrangement: hold a section's name to move or hide it.

    private enum HomeSection: String, CaseIterable { case recent, tasks, calendar
        var name: String { switch self { case .recent: "Recent"; case .tasks: "Tasks"; case .calendar: "Calendar" } }
    }
    @AppStorage("home.order") private var orderRaw = "recent,tasks,calendar"
    @AppStorage("home.hidden") private var hiddenRaw = ""
    private var order: [HomeSection] {
        let saved = orderRaw.split(separator: ",").compactMap { HomeSection(rawValue: String($0)) }
        return saved + HomeSection.allCases.filter { !saved.contains($0) }
    }
    private var hidden: [HomeSection] { hiddenRaw.split(separator: ",").compactMap { HomeSection(rawValue: String($0)) } }
    private var shown: [HomeSection] { order.filter { !hidden.contains($0) && ($0 != .recent || !items.isEmpty) } }

    private func move(_ s: HomeSection, _ by: Int) {
        var o = order
        guard let i = o.firstIndex(of: s), o.indices.contains(i + by) else { return }
        o.swapAt(i, i + by)
        Haptics.tap()
        orderRaw = o.map(\.rawValue).joined(separator: ",")
    }
    private func hide(_ s: HomeSection) {
        Haptics.thud()
        hiddenRaw = (hidden + [s]).map(\.rawValue).joined(separator: ",")
        Toaster.shared.show("\(s.name) hidden", detail: "Bring it back at the bottom of Home",
                            action: ("Undo", { show(s) }))
    }
    private func show(_ s: HomeSection) { hiddenRaw = hidden.filter { $0 != s }.map(\.rawValue).joined(separator: ",") }

    @ViewBuilder private func arrangeMenu(_ s: HomeSection) -> some View {
        let i = order.firstIndex(of: s) ?? 0
        Button("Move up", systemImage: "arrow.up") { move(s, -1) }.disabled(i == 0)
        Button("Move down", systemImage: "arrow.down") { move(s, 1) }.disabled(i == order.count - 1)
        Divider()
        Button("Hide \(s.name)", systemImage: "eye.slash") { hide(s) }
    }

    /// The sections in your order. On iPad, Tasks and Calendar sit side by side when they're next to each other.
    @ViewBuilder private var sections: some View {
        let list = shown
        ForEach(Array(list.enumerated()), id: \.element) { i, s in
            if !compact, s == .calendar, i > 0, list[i - 1] == .tasks {
                EmptyView()
            } else if !compact, s == .tasks, i + 1 < list.count, list[i + 1] == .calendar {
                HStack(alignment: .top, spacing: 14) { section(.tasks); section(.calendar) }
            } else {
                section(s)
            }
        }
    }

    @ViewBuilder private func section(_ s: HomeSection) -> some View {
        Group {
            switch s {
            case .recent: recentRow
            case .tasks: tasksPanel
            case .calendar: calendarPanel
            }
        }
        .contextMenu { arrangeMenu(s) }
        .transition(.opacity.combined(with: .scale(scale: 0.98)))
    }

    private var hiddenRow: some View {
        HStack(spacing: 8) {
            ForEach(hidden, id: \.self) { s in
                Button { Haptics.tap(); show(s) } label: {
                    Label("Show \(s.name)", systemImage: "plus").font(.footnote.weight(.medium))
                        .padding(.horizontal, 12).frame(height: 32)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 6)
    }

    // MARK: Now: the event you're in, or the next one soon, with what you'd want to do about it.

    @ViewBuilder private func nowCard(_ now: Date) -> some View {
        let current = todays.first { !$0.allDay && $0.start <= now && $0.end > now }
        let next = todays.first { !$0.allDay && $0.start > now && $0.start.timeIntervalSince(now) < 90 * 60 }
        if let e = current ?? next {
            let live = current != nil
            let minutes = Int(((live ? e.end : e.start).timeIntervalSince(now) / 60).rounded(.up))
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Circle().fill(live ? Color.red : e.color).frame(width: 8, height: 8)
                        .phaseAnimator(live ? [1.0, 0.35] : [1.0]) { c, o in c.opacity(o) } animation: { _ in .easeInOut(duration: 1) }
                    Text(live ? "Now · \(minutes) min left" : "Next · in \(minutes) min")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    if let place = e.location, !place.isEmpty {
                        Label(place, systemImage: "mappin").font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Text(e.title).font(.title3.weight(.semibold)).lineLimit(2)
                HStack(spacing: 8) {
                    if live && !recorder.isRecording {
                        Button { recordNow(e.title) } label: {
                            Label("Record", systemImage: "mic.fill").font(.subheadline.weight(.semibold)).padding(.horizontal, 4)
                        }
                        .buttonStyle(.glassProminent).tint(.red)
                    }
                    Button { notes(for: e.title) } label: {
                        Label(live ? "Take notes" : "Prep notes", systemImage: "square.and.pencil").font(.subheadline.weight(.semibold)).padding(.horizontal, 4)
                    }
                    .buttonStyle(.glass)
                    if !live {
                        Button { router.openCalendar(e.start) } label: {
                            Text("Open").font(.subheadline.weight(.semibold)).padding(.horizontal, 4)
                        }
                        .buttonStyle(.glass)
                    }
                }
            }
            .padding(Space.card)
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel(radius: 24)
            .transition(.opacity)
        }
    }

    private func recordNow(_ title: String) {
        let l = Item(.lecture, title: "\(title) · \(Date.now.formatted(.dateTime.month(.abbreviated).day()))")
        ctx.insert(l)
        recorder.start(l)
        Haptics.success()
        router.open(l)
    }

    /// One doc per event and day: opening it again goes back to the same notes.
    private func notes(for title: String) {
        let name = "\(title) · \(Date.now.formatted(.dateTime.month(.abbreviated).day()))"
        if let existing = items.first(where: { $0.kind == .doc && $0.title == name }) { return router.open(existing) }
        let d = Item(.doc, title: name)
        ctx.insert(d)
        router.open(d)
    }

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
                    .contentShape(.rect)
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
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    @State private var text = ""
    @FocusState private var focused: Bool
    private var query: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var empty: Bool { query.isEmpty }

    /// What the words could be, best guess first: Return does the first.
    private enum Intent: Hashable { case task, event, ask, doc, open(Item) }
    private var intents: [Intent] {
        guard !empty else { return [] }
        let parsed = QuickAdd.parse(query)
        var out: [Intent]
        if Self.isQuestion(query) { out = [.ask, .task, .doc] }
        else if let p = parsed, !p.allDay, !p.due { out = [.event, .task, .ask, .doc] }
        else if parsed != nil { out = [.task, .event, .ask, .doc] }
        else { out = [.task, .ask, .doc] }
        if !Assistant.isAvailable { out.removeAll { $0 == .ask } }
        if query.count > 1 {
            out += items.filter { $0.title.localizedCaseInsensitiveContains(query) }.prefix(2).map { .open($0) }
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if focused && !empty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(intents.enumerated()), id: \.element) { i, intent in
                            Button { run(intent) } label: { chip(intent, first: i == 0) }
                                .buttonStyle(.card)
                        }
                    }
                    .padding(.horizontal, 2).padding(.vertical, 2)
                }
                .scrollClipDisabled()
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            field
        }
        .animation(.snappy(duration: 0.22), value: focused && !empty)
    }

    private var field: some View {
        HStack(spacing: 8) {
            NewMenu {
                Image(systemName: "plus").font(.title3.weight(.medium)).foregroundStyle(.primary)
                    .frame(width: 44, height: 44)
                    .background(Color.primary.opacity(0.08), in: .circle)
            }
            TextField("Add, ask or search", text: $text, axis: .vertical)
                .lineLimit(1...5)
                .focused($focused)
                .submitLabel(.go)
                .onSubmit { if let first = intents.first { run(first) } }
                .padding(.vertical, 12)
            Button { if empty { record() } else if let first = intents.first { run(first) } } label: {
                Image(systemName: empty ? "mic.fill" : "arrow.up").font(.body.weight(.semibold))
                    .frame(width: 44, height: 44)
                    .foregroundStyle(empty ? AnyShapeStyle(.primary) : AnyShapeStyle(Theme.paper))
                    .background(empty ? AnyShapeStyle(Color.primary.opacity(0.08)) : AnyShapeStyle(.tint), in: .circle)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)
            .disabled(empty && recorder.isRecording)
            .accessibilityLabel(empty ? "Record" : "Go")
        }
        .padding(6)
        .glassEffect(.regular, in: .rect(cornerRadius: 28, style: .continuous))
        .animation(.snappy(duration: 0.2), value: empty)
        .onChange(of: focused) { if focused { Assistant.warm() } }
        .onAppear { if router.focusAsk { router.focusAsk = false; focused = true } }
        .onChange(of: router.focusAsk) { if router.focusAsk { router.focusAsk = false; focused = true } }
    }

    private func chip(_ intent: Intent, first: Bool) -> some View {
        let (symbol, label): (String, String) = {
            let parsed = QuickAdd.parse(query)
            let when = parsed.map { p in
                let cal = Calendar.current
                let day = cal.isDateInToday(p.start) ? "Today" : cal.isDateInTomorrow(p.start) ? "Tomorrow"
                    : p.start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
                return p.allDay ? day : "\(day) \(p.start.formatted(date: .omitted, time: .shortened))"
            }
            switch intent {
            case .task: return ("checklist", "Task" + (when.map { " · \($0)" } ?? ""))
            case .event: return ("calendar.badge.plus", "Event" + (when.map { " · \($0)" } ?? ""))
            case .ask: return ("sparkle", "Ask")
            case .doc: return ("doc.badge.plus", "New doc")
            case .open(let item): return (item.kind == .lecture ? "waveform" : "doc.text", item.displayTitle)
            }
        }()
        return HStack(spacing: 6) {
            Image(systemName: symbol).font(.footnote.weight(.semibold))
            Text(label).font(.subheadline.weight(first ? .semibold : .regular)).lineLimit(1)
            if first { Image(systemName: "return").font(.caption2.weight(.semibold)).foregroundStyle(.secondary) }
        }
        .padding(.horizontal, 14).frame(height: 38)
        .foregroundStyle(first ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private func run(_ intent: Intent) {
        let q = query
        guard !q.isEmpty else { return }
        switch intent {
        case .task:
            guard let task = Todos.make(q) else { return }
            withAnimation(.snappy) { ctx.insert(task) }
            Haptics.success()
            Toaster.shared.show("Added to Tasks", detail: task.due == nil ? nil : Todos.label(task),
                                action: ("Undo", { [ctx] in withAnimation(.snappy) { ctx.delete(task) } }))
        case .event:
            guard let p = QuickAdd.parse(q) else { return }
            let e = Event(title: p.title, start: p.start, end: p.end, allDay: p.allDay, location: p.location)
            e.color = p.color
            ctx.insert(e)
            PhoneLink.shared.sendAgenda()
            Haptics.success()
            Toaster.shared.show("Added \(e.title)", detail: e.start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()),
                                action: ("Undo", { [ctx] in ctx.delete(e); PhoneLink.shared.sendAgenda() }))
        case .ask:
            router.ask(question: q)
        case .doc:
            let d = Item(.doc, title: q)
            ctx.insert(d)
            router.open(d)
        case .open(let item):
            router.open(item)
        }
        text = ""
        if case .task = intent {} else { focused = false }
    }

    private static let questionWords: Set<String> = ["what", "when", "where", "who", "why", "how", "do", "does", "did", "is", "are", "am", "can", "could", "should", "will", "would", "which", "any", "show", "list", "find", "tell", "summarize", "explain", "help"]
    static func isQuestion(_ t: String) -> Bool {
        if t.contains("?") { return true }
        let first = t.lowercased().split(whereSeparator: { !$0.isLetter }).first.map(String.init) ?? ""
        return questionWords.contains(first)
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

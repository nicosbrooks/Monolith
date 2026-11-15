import SwiftUI
import SwiftData

/// Schedule, open tasks, and recent work above the floating Ask bar.
struct TodayView: View {
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    @Query(sort: \Event.start) private var events: [Event]
    @State private var path: [Item] = []
    @State private var brief: String?
    @State private var briefing = false
    @State private var briefError: String?
    /// Dismissed and accepted suggestions, kept across launches so nothing is offered twice.
    @AppStorage("dismissedSuggestions") private var dismissedRaw = ""
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
    @State private var allTasksShown = false
    /// Tasks just ticked, waiting a moment before they leave the list.
    @State private var checking: Set<String> = []
    private var canPlan: Bool { Assistant.isAvailable && (!todays.isEmpty || !tasks.isEmpty) }
    private var planButton: some View {
        Button { Task { await planDay() } } label: {
            if briefing { ProgressView().controlSize(.small) } else if compact { Image(systemName: "sparkles") } else { Text("Plan my day") }
        }
        .disabled(briefing)
        .accessibilityLabel("Plan my day")
    }

    /// Derived lists, rebuilt shortly after notes or events change rather than on every redraw:
    /// scanning notes for dates and tasks is the costliest thing this screen does.
    private struct Derived {
        var todays: [AgendaItem] = []
        var tasks: [(item: Item, line: String)] = []
        var taskCount = 0
        var nudge: Suggestion?
    }
    @State private var derived = Derived()
    @State private var derivedOnce = false
    private var todays: [AgendaItem] { derived.todays }
    private var tasks: [(item: Item, line: String)] { derived.tasks }
    private var nudge: Suggestion? { derived.nudge }
    /// Changes when anything this screen derives from changes.
    private var stamp: String {
        let ev = events.reduce(0) { $0 ^ $1.start.hashValue ^ $1.end.hashValue ^ $1.title.hashValue }
        return "\(items.count)|\(items.first?.updatedAt.timeIntervalSince1970 ?? 0)|\(events.count)|\(ev)|\(DeviceCalendars.shared.version)|\(dismissedRaw.count)|\(Calendar.current.startOfDay(for: .now).timeIntervalSince1970)"
    }
    private func rederive() {
        let all = allTasks
        derived = Derived(todays: computeTodays, tasks: Array(all.prefix(6)), taskCount: all.count,
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
    private var allTasks: [(item: Item, line: String)] {
        items.filter { $0.kind != .lecture }.flatMap { i in Tasks.open(in: i.body).map { (i, $0) } }
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: compact ? 26 : 14) {
                    if compact { phoneHome } else {
                    if compact {
                        // iPhone: the date is the title; Plan my day sits in the toolbar.
                        Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                            .font(.title2.bold()).accessibilityAddTraits(.isHeader)
                    } else {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Home").font(.title.bold()).accessibilityAddTraits(.isHeader)
                                Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if canPlan { planButton.buttonStyle(.bordered) }
                        }
                        .padding(.bottom, 6)
                    }

                    if let briefError {
                        panel("Daily plan", icon: "sparkles") {
                            Text(briefError).font(.subheadline).foregroundStyle(.secondary)
                            Button("Dismiss") { self.briefError = nil }.font(.footnote)
                        }
                    } else if let brief {
                        panel("Daily plan", icon: "sparkles") {
                            MarkdownBlocks(markdown: brief)
                            Button("Dismiss") { self.brief = nil }.font(.footnote)
                        }
                    }

                    panel("Schedule", icon: "calendar", status: scheduleStatus) {
                        WeekStrip(events: events)
                        if let s = nudge { suggestionRow(s) }
                    }

                    let layout = size == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 14)) : AnyLayout(VStackLayout(spacing: 14))
                    layout {
                        panel("Open tasks", icon: "checkmark.square", status: derived.taskCount == 0 ? nil : "\(derived.taskCount) open") {
                            taskRows
                            moreTasks
                        }
                        panel("Recent work", icon: "clock") {
                            recentRows
                        }
                    }
                    }
                }
                .frame(maxWidth: 960, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 18)
                .padding(.top, compact ? 0 : 28)
                .padding(.bottom, compact ? 110 : 28)
            }
            .paper()
            .navigationTitle(compact ? Date.now.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()) : "")
            .navigationBarTitleDisplayMode(.inline)
            .drawerButton()
            .toolbar {
                
            }
            .navigationDestination(for: Item.self) { ItemDetail(item: $0) }
            .task(id: stamp) {
                // Typing changes a note several times a second; wait for a pause before rescanning.
                if derivedOnce { try? await Task.sleep(for: .milliseconds(400)) }
                guard !Task.isCancelled else { return }
                rederive()
                derivedOnce = true
            }
        }
    }


    // MARK: iPhone: three short lists with small labels, like Granola or Notion. No week strip, no cards.

    /// What's left today, or the next thing coming if today is done.
    private var comingUp: [AgendaItem] {
        let left = todays.filter { $0.allDay || $0.end > .now }
        return Array((left.isEmpty ? upcoming.prefix(1) : left.prefix(3)))
    }

    @ViewBuilder private var phoneHome: some View {
        if showsAssistant { assistantCard }

        section("Today") {
            if comingUp.isEmpty {
                Text("Nothing else today").font(.subheadline).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            }
            ForEach(comingUp) { e in
                Button { router.openCalendar(e.start) } label: {
                    row {
                        Circle().fill(e.color).frame(width: 8, height: 8)
                    } title: { Text(e.title) } trailing: {
                        Text(e.allDay ? "All day" : Calendar.current.isDateInToday(e.start)
                             ? e.start.formatted(date: .omitted, time: .shortened)
                             : e.start.formatted(.dateTime.weekday(.abbreviated).hour().minute()))
                            .font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.row)
            }
        }

        if !visibleTasks.isEmpty {
            section("Tasks") {
                ForEach(Array(visibleTasks.prefix(allTasksShown ? 8 : 3).enumerated()), id: \.offset) { _, task in
                    taskRow(task)
                }
                if !allTasksShown && visibleTasks.count > 3 {
                    Button { withAnimation(.snappy) { allTasksShown = true } } label: {
                        row { Image(systemName: "chevron.down").font(.footnote).foregroundStyle(.secondary) }
                            title: { Text("\(visibleTasks.count - 3) more").foregroundStyle(.secondary) } trailing: { EmptyView() }
                    }
                    .buttonStyle(.row)
                }
            }
        }

        if !items.isEmpty {
            section("Recent") {
                ForEach(items.prefix(5)) { item in
                    ItemLink(item: item) {
                        row {
                            if let e = item.displayEmoji { Text(e).font(.subheadline) }
                            else { Image(systemName: item.kind.symbol).font(.subheadline).foregroundStyle(.secondary) }
                        } title: { Text(item.displayTitle) } trailing: {
                            Text(item.updatedAt.shortRelative).font(.footnote.monospacedDigit()).foregroundStyle(.tertiary)
                        }
                    }
                    .buttonStyle(.row)
                    .contextMenu { ItemMenu(item: item) }
                }
                if items.count > 5 {
                    NavigationLink { AllRecentsView() } label: {
                        row { Image(systemName: "clock").font(.subheadline).foregroundStyle(.secondary) }
                            title: { Text("See all") } trailing: {
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                    }
                    .buttonStyle(.row)
                }
            }
        }
    }

    // MARK: Assistant card: the one place the assistant speaks on Home.

    private var showsAssistant: Bool { nudge != nil || brief != nil || briefing || briefError != nil || canPlan }

    /// Tasks, minus the one the assistant is already asking about (no saying the same thing twice).
    private var visibleTasks: [(item: Item, line: String)] {
        guard let n = nudge else { return tasks }
        return tasks.filter { !($0.item.id == n.itemID && MD.plain($0.line) == n.line) }
    }

    @ViewBuilder private var assistantCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let brief {
                header("Your day")
                MarkdownBlocks(markdown: brief).font(.subheadline)
                HStack { pill("Done", primary: false) { withAnimation(.snappy) { self.brief = nil } } }
            } else if briefing {
                header("Planning your day…")
                ProgressView().frame(maxWidth: .infinity, alignment: .leading)
            } else if let s = nudge {
                suggestionCard(s)
            } else if let briefError {
                header("Couldn’t plan your day")
                Text(briefError).font(.subheadline).foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    pill("Try again", primary: true) { Task { await planDay() } }
                    pill("Dismiss", primary: false) { self.briefError = nil }
                }
            } else {
                header("Plan your day")
                Text("A short plan from your calendar and \(derived.taskCount) open task\(derived.taskCount == 1 ? "" : "s").")
                    .font(.subheadline).foregroundStyle(.secondary)
                HStack { pill("Plan my day", primary: true) { Task { await planDay() } } }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: .rect(cornerRadius: 26, style: .continuous))
        .animation(.snappy, value: nudge?.id)
    }

    private func header(_ t: String) -> some View {
        Label { Text(t).font(.subheadline.weight(.semibold)) } icon: { Image(systemName: "sparkles") }
            .foregroundStyle(.secondary)
    }

    /// A date the assistant found in a doc: what, when, exactly where it came from, and two clear choices.
    private func suggestionCard(_ s: Suggestion) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            header("Add to your calendar?")
            VStack(alignment: .leading, spacing: 4) {
                Text(s.title).font(.title3.weight(.semibold))
                Text(s.date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day().hour().minute()))
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if let doc = items.first(where: { $0.id == s.itemID }) {
                ItemLink(item: doc) {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "doc.text").font(.footnote).foregroundStyle(.secondary).padding(.top, 2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(doc.displayTitle).font(.footnote.weight(.medium)).lineLimit(1)
                            Text("\u{201C}\(s.line)\u{201D}").font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .background(Theme.wash, in: .rect(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the doc")
            }
            HStack(spacing: 10) {
                pill("Add to calendar", primary: true) { add(s) }
                pill("Not now", primary: false) { dismiss(s.id); Toaster.shared.show("Suggestion hidden", action: ("Undo", { undismiss(s.id) })) }
            }
        }
    }

    private func pill(_ title: String, primary: Bool, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(title).font(.subheadline.weight(.semibold))
                .padding(.horizontal, 18).frame(height: 40)
                .foregroundStyle(primary ? Theme.paper : .primary)
                .background(primary ? Color.primary : Theme.wash, in: .capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
    }

    /// One Home row: a 20pt icon column (so every section lines up), the title, and a quiet detail on the right.
    private func row<Icon: View, Title: View, Trailing: View>(@ViewBuilder icon: () -> Icon, @ViewBuilder title: () -> Title, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 10) {
            icon().frame(width: 20)
            title().lineLimit(1)
            Spacer(minLength: 8)
            trailing()
        }
        .frame(minHeight: 50).contentShape(.rect)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).padding(.leading, 4)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 2) { content() }
                .padding(.horizontal, 14).padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.card, in: .rect(cornerRadius: 22, style: .continuous))
        }
    }

    /// Tap the circle to check a task off. It stays a moment, struck through, so a mis-tap can be taken back.
    /// Tap the words to open the doc it lives in.
    private func taskRow(_ task: (item: Item, line: String)) -> some View {
        let key = "\(task.item.id)|\(task.line)"
        let done = checking.contains(key)
        return HStack(spacing: 10) {
            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                if done { withAnimation(.snappy) { _ = checking.remove(key) }; return }
                withAnimation(.snappy) { _ = checking.insert(key) }
                Task {
                    try? await Task.sleep(for: .seconds(1.5))
                    guard checking.contains(key) else { return }
                    withAnimation(.snappy) {
                        task.item.body = Tasks.check(task.line, in: task.item.body); task.item.touch()
                        checking.remove(key); rederive()
                    }
                }
            } label: {
                Image(systemName: done ? "checkmark.square.fill" : "square").font(.body)
                    .foregroundStyle(done ? .primary : .secondary)
                    .frame(width: 20, height: 44).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(done ? "Undo" : "Mark complete")
            ItemLink(item: task.item) {
                HStack {
                    Text(MD.inline(task.line)).lineLimit(1).strikethrough(done).foregroundStyle(done ? .secondary : .primary)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44).contentShape(.rect)
            }
            .buttonStyle(.row)
        }
    }

    private func quiet(_ t: String) -> some View {
        Text(t).font(.subheadline).foregroundStyle(.tertiary).frame(minHeight: 40, alignment: .leading).padding(.leading, 30)
    }

    private var scheduleStatus: String {
        let count = todays.filter { $0.allDay || $0.end > .now }.count
        if count > 0 { return "\(count) event\(count == 1 ? "" : "s") left today" }
        return todays.isEmpty ? "Nothing scheduled today" : "Finished for today"
    }

    private func panel<Content: View>(_ title: String, icon: String, status: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if compact {
                // iPhone: a plain heading over rows; no boxes, icons or counts.
                Text(title).font(.headline).accessibilityAddTraits(.isHeader)
            } else {
                HStack {
                    Label(title, systemImage: icon).font(.sub).accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 4)
                    if let status { Text(status).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(compact ? 0 : 14)
        .background(compact ? Color.clear : Theme.panel, in: .rect(cornerRadius: 16))
        .overlay { if !compact { RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.rule).allowsHitTesting(false) } }
    }

    private func suggestionRow(_ suggestion: Suggestion) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(suggestion.title).font(.subheadline)
                Text(suggestion.date.formatted(.dateTime.weekday(.abbreviated).day().hour().minute()))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button("Add") { add(suggestion) }.buttonStyle(.bordered)
            Button { dismiss(suggestion.id) } label: { Image(systemName: "xmark").font(.footnote.weight(.semibold)) }
                .buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Not needed")
        }
    }

    @ViewBuilder private var taskRows: some View {
        if tasks.isEmpty { Text("No open tasks.").font(.subheadline).foregroundStyle(.secondary) }
        ForEach(Array(tasks.prefix(compact && !allTasksShown ? 3 : 6).enumerated()), id: \.offset) { _, task in
            Button {
                withAnimation(.snappy) { task.item.body = Tasks.check(task.line, in: task.item.body); task.item.touch(); rederive() }
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "square").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(MD.inline(task.line)).multilineTextAlignment(.leading)
                        if !compact { Text(task.item.displayTitle).font(.footnote).foregroundStyle(.secondary).lineLimit(1) }
                    }
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Mark complete")
        }
    }

    @ViewBuilder private var moreTasks: some View {
        if compact && !allTasksShown && derived.taskCount > 3 {
            Button("Show all \(derived.taskCount)") { withAnimation(.snappy) { allTasksShown = true } }
                .font(.subheadline).foregroundStyle(.secondary).frame(minHeight: 44)
        }
    }

    @ViewBuilder private var recentRows: some View {
        if items.isEmpty { Text("Nothing yet.").font(.subheadline).foregroundStyle(.secondary) }
        ForEach(items.prefix(3)) { item in
            ItemLink(item: item) {
                HStack(spacing: 10) {
                    if let emoji = item.displayEmoji {
                        Text(emoji)
                    } else {
                        Image(systemName: item.kind.symbol).foregroundStyle(.secondary)
                    }
                    Text(item.displayTitle).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(item.updatedAt.shortRelative).font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
                }
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .contextMenu { ItemMenu(item: item) }
        }
    }


    private func add(_ s: Suggestion) {
        let e = Event(title: s.title, start: s.date, end: s.date.addingTimeInterval(3600))
        ctx.insert(e)
        PhoneLink.shared.sendAgenda()
        dismiss(s.id)
        Toaster.shared.show("Added to calendar", detail: s.date.formatted(.dateTime.weekday(.wide).hour().minute()),
                            action: ("Undo", { [ctx] in ctx.delete(e); PhoneLink.shared.sendAgenda(); undismiss(s.id) }))
    }

    private func planDay() async {
        briefing = true
        briefError = nil
        defer { briefing = false }
        let ctxText = """
        Today: \(Date.now.formatted(date: .complete, time: .shortened))
        Events: \(todays.map { "\($0.start.formatted(date: .omitted, time: .shortened)) \($0.title)" }.joined(separator: "; "))
        This week: \(upcoming.map { "\($0.start.formatted(.dateTime.weekday().hour().minute())) \($0.title)" }.joined(separator: "; "))
        Open tasks: \(tasks.map(\.line).joined(separator: "; "))
        """
        do {
            let out = try await Assistant.ask(
                "Write a calm daily brief in under 80 words: the single most important thing today, then 2–3 short bullets for a realistic plan with times. Use only what is listed. No greeting.",
                context: ctxText)
            withAnimation { brief = out }
        } catch {
            briefError = error.localizedDescription
        }
    }
}

/// The selected date opens in place and can jump directly to Calendar.
private struct WeekStrip: View {
    var events: [Event]
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var selected: Date?

    var body: some View {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: .now)
        let days = (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
        let active = selected.flatMap { days.contains($0) ? $0 : nil } ?? start
        VStack(alignment: .leading, spacing: 7) {
            if typeSize.isAccessibilitySize {
                ScrollView(.horizontal) { daysRow(days, active: active) }
            } else {
                daysRow(days, active: active)
            }
            let next = calendar.date(byAdding: .day, value: 1, to: active) ?? active
            let items = agenda(events, from: active, to: next)
            if items.isEmpty {
                Text("Nothing scheduled").font(.footnote).foregroundStyle(.secondary)
                    .padding(.horizontal, 10).padding(.top, 6)
            } else {
                ForEach(items.prefix(3)) { item in
                    HStack(spacing: 7) {
                        Circle().fill(item.color).frame(width: 6, height: 6)
                        Text(item.allDay ? "All day" : item.start.formatted(date: .omitted, time: .shortened))
                            .foregroundStyle(.secondary)
                        Text(item.title).lineLimit(2)
                    }
                    .font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                }
            }
            if items.count > 3 {
                Button("+\(items.count - 3) more") { router.openCalendar(active) }
                    .font(.footnote).foregroundStyle(.secondary).buttonStyle(.plain)
                    .frame(minHeight: 44).padding(.horizontal, 10)
            }
        }
    }

    private func daysRow(_ days: [Date], active: Date) -> some View {
        HStack(spacing: 4) {
            ForEach(days, id: \.self) { day in
                let on = day == active
                Button {
                    if on { router.openCalendar(day) } else { withAnimation(reduceMotion ? nil : .snappy) { selected = day } }
                } label: {
                    VStack(spacing: 4) {
                        Text(Calendar.current.isDateInToday(day) ? "Today" : day.formatted(.dateTime.weekday(.abbreviated)))
                            .font(.caption2.weight(on ? .semibold : .regular))
                            .foregroundStyle(on ? .primary : .secondary)
                        Text(day.formatted(.dateTime.day())).font(.callout.weight(.semibold).monospacedDigit())
                    }
                    .frame(minWidth: 32, maxWidth: on ? .infinity : 42, minHeight: 52)
                    .padding(.horizontal, on ? 6 : 0)
                    .background(on ? Theme.raised : Theme.wash, in: .rect(cornerRadius: 12))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityHint(on ? "Open in Calendar" : "")
            }
        }
    }
}


/// Everything recent, newest first: Home and the drawer show five and link here.
struct AllRecentsView: View {
    var onOpen: ((Item) -> Void)? = nil
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]
    var body: some View {
        List(items) { item in
            Group {
                if let onOpen { Button { onOpen(item) } label: { ItemRow(item: item, showKind: true) }.buttonStyle(.plain) }
                else { ItemLink(item: item) { ItemRow(item: item, showKind: true) } }
            }
            .listRowSeparator(.hidden).listRowBackground(Color.clear)
            .contextMenu { ItemMenu(item: item) }
        }
        .compactList()
        .navigationTitle("Recent")
        .navigationBarTitleDisplayMode(.inline)
    }
}

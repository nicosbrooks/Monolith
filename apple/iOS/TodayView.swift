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
    @State private var allTasksShown = false
    /// Starting points for a conversation, built from what's actually on today. Each one opens chat with
    /// the question asked, so the person can take it anywhere from there. Never a fixed plan.
    /// "Start from here" on the first day; after that, what the starting points are about.
    private var startersTitle: String {
        let soon = comingUp.first.map { !$0.allDay && $0.start.timeIntervalSinceNow < 90 * 60 } ?? false
        return Greeting.startersTitle(setupAt: setupAt, soon: soon, onlyDocs: starters.count == 1 && starters[0].symbol == "doc.text")
    }

    private var starters: [(symbol: String, text: String)] {
        guard Assistant.isAvailable else { return [] }
        var out: [(String, String)] = []
        if let next = comingUp.first(where: { !$0.allDay }) ?? comingUp.first {
            out.append(("calendar", "Help me get ready for \u{201C}\(next.title)\u{201D}"))
        }
        if derived.taskCount > 1 {
            out.append(("checkmark.square", "Which of my \(derived.taskCount) tasks should I do first?"))
        } else if let t = tasks.first {
            out.append(("checkmark.square", "Help me with \u{201C}\(t.title)\u{201D}"))
        }
        if let doc = items.first(where: { $0.kind == .doc && !$0.body.isEmpty }) {
            out.append(("doc.text", "Summarize \u{201C}\(doc.displayTitle)\u{201D}"))
        } else if let rec = items.first(where: { $0.kind == .lecture }) {
            out.append(("mic", "What were the key points of \u{201C}\(rec.displayTitle)\u{201D}?"))
        }
        if out.isEmpty { out.append(("bubble.left", "What can you help me with?")) }
        return Array(out.prefix(3))
    }

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
                VStack(alignment: .leading, spacing: compact ? Space.section : 14) {
                    if compact { phoneHome } else {
                    if compact {
                        Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                            .font(.title2.bold()).accessibilityAddTraits(.isHeader)
                    } else {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(Greeting.text(name: userName, away: away)).font(.title.bold()).accessibilityAddTraits(.isHeader)
                                Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .padding(.bottom, 6)
                    }

                    if showsAssistant { assistantCard }

                    panel("Calendar", icon: "calendar", status: scheduleStatus) {
                        WeekStrip(events: events)
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
                .padding(.horizontal, Space.page)
                .padding(.top, compact ? 8 : 28)
                .padding(.bottom, compact ? 120 : 28)
            }
            .paper()
            .navigationTitle("")
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
                integrations.upcoming(events.map { ($0.title, $0.location ?? "", $0.start) })
                integrations.refresh()
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
        VStack(alignment: .leading, spacing: 4) {
            Text(Greeting.text(name: userName, away: away))
                .font(.title.bold()).accessibilityAddTraits(.isHeader)
            Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                .font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.bottom, -Space.section + 16)
        // Only once the docs have been read for dates, so the card appears once, in its final form, without a jump.
        if derivedOnce && showsAssistant { assistantCard.transition(.opacity) }

        // Weather sits beside the label, quietly, when that integration is on.
        let weather = integrations.isOn(.weather) ? integrations.weather : nil
        section("Calendar", trailing: weather?.line, symbol: weather?.symbol) {
            if comingUp.isEmpty {
                Text("Nothing coming up").font(.subheadline).foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
            }
            ForEach(comingUp) { e in
                Button { router.openCalendar(e.start) } label: { eventRow(e) }
                    .buttonStyle(.row)
            }
            // Maps: when to leave for the next event that has a place.
            if integrations.isOn(.maps), let t = integrations.trip {
                Button { router.openCalendar(t.start) } label: {
                    row {
                        Image(systemName: t.walking ? "figure.walk" : "car").font(.subheadline).foregroundStyle(.secondary)
                    } title: {
                        Text("Leave by \(t.leaveBy.formatted(date: .omitted, time: .shortened))").foregroundStyle(.secondary)
                    } trailing: {
                        Text(t.line).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.row)
                .accessibilityLabel("Leave by \(t.leaveBy.formatted(date: .omitted, time: .shortened)) for \(t.event), \(t.line)")
            }
        }

        if !tasks.isEmpty {
            section("Tasks") {
                ForEach(tasks.prefix(3)) { TodoRow(todo: $0) }
                if derived.taskCount > 3 {
                    Button { router.showTasks = true } label: {
                        row { Image(systemName: "checklist").font(.subheadline).foregroundStyle(.secondary) }
                            title: { Text("All \(derived.taskCount) tasks").foregroundStyle(.secondary) } trailing: {
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            }
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
                    .itemMenu(item)
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

    private var showsAssistant: Bool { nudge != nil || !starters.isEmpty }

    @ViewBuilder private var assistantCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let s = nudge {
                suggestionCard(s)
            } else {
                header(startersTitle)
                VStack(spacing: 0) {
                    ForEach(starters, id: \.text) { s in
                        Button { router.ask = s.text } label: {
                            HStack(spacing: 12) {
                                Image(systemName: s.symbol).font(.subheadline).foregroundStyle(.secondary).frame(width: 20)
                                Text(s.text).font(.subheadline).multilineTextAlignment(.leading).lineLimit(2)
                                Spacer(minLength: 6)
                                Image(systemName: "arrow.up.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.row)
                        .accessibilityHint("Asks the assistant")
                    }
                }
            }
        }
        .padding(Space.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: .rect(cornerRadius: 24, style: .continuous))
        .animation(.snappy, value: nudge?.id)
    }

    private func header(_ t: String) -> some View {
        // Words only: a sparkle reads as "AI" rather than saying anything.
        Text(t).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
    }

    /// A date the assistant found in a doc: what, when, exactly where it came from, and two clear choices.
    private func suggestionCard(_ s: Suggestion) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            header("Add to your calendar?")
            VStack(alignment: .leading, spacing: 4) {
                Text(s.title).font(.title3.weight(.semibold))
                Text(s.date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day().hour().minute()))
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if let doc = items.first(where: { $0.id == s.itemID }) {
                ItemLink(item: doc) {
                    // Where it came from, in one quiet line: the doc's name, then the words it found.
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
                pill("Add to calendar", primary: true) { add(s) }
                pill("Not now", primary: false) { dismiss(s.id); Toaster.shared.show("Suggestion hidden", action: ("Undo", { undismiss(s.id) })) }
            }
        }
    }

    private func pill(_ title: String, primary: Bool, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(title).font(.subheadline.weight(.semibold))
                .padding(.horizontal, 16).frame(height: 36)
                .foregroundStyle(primary ? Theme.paper : .primary)
                .background(primary ? Color.primary : Theme.wash, in: .capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
    }

    /// One Home row: a 20pt icon column (so every section lines up), the title, and a quiet detail on the right.
    private func row<Icon: View, Title: View, Trailing: View>(@ViewBuilder icon: () -> Icon, @ViewBuilder title: () -> Title, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 14) {
            icon().frame(width: 22)
            title().lineLimit(1)
            Spacer(minLength: 8)
            trailing()
        }
        .frame(minHeight: Space.row).contentShape(.rect)
    }

    /// An event on Home: title with its place underneath, start and end on the right.
    /// A day other than today leads the second line ("Thu · Room 204") so the times stay short.
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

    private func section<Content: View>(_ title: String, trailing: String? = nil, symbol: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let trailing {
                    if let symbol { Image(systemName: symbol).symbolRenderingMode(.multicolor) }
                    Text(trailing).foregroundStyle(.secondary)
                }
            }
            .font(.subheadline)
            // Plain rows under a small label: only the assistant gets a card, so Home reads as one calm list.
            VStack(alignment: .leading, spacing: 0) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func quiet(_ t: String) -> some View {
        Text(t).font(.subheadline).foregroundStyle(.tertiary).frame(minHeight: 44, alignment: .leading).padding(.leading, 36)
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

    @ViewBuilder private var taskRows: some View {
        if tasks.isEmpty { Text("Nothing to do. Add one from Tasks.").font(.subheadline).foregroundStyle(.secondary) }
        ForEach(tasks.prefix(compact && !allTasksShown ? 3 : 6)) { TodoRow(todo: $0) }
    }

    @ViewBuilder private var moreTasks: some View {
        if derived.taskCount > 6 || (compact && !allTasksShown && derived.taskCount > 3) {
            Button("All \(derived.taskCount) tasks") { router.showTasks = true }
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
            .itemMenu(item)
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
            .itemMenu(item)
        }
        .compactList()
        .navigationTitle("Recent")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private extension String {
    var nonEmptyOrNil: String? { isEmpty ? nil : self }
}

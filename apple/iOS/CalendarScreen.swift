import SwiftUI
import SwiftData

/// A week strip over a day agenda, plus natural-language quick add.
struct CalendarScreen: View {
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @Query(sort: \Event.start) private var events: [Event]
    @State private var day = Calendar.current.startOfDay(for: .now)
    @State private var editing: Event?
    @State private var creating = false

    private var week: [Date] {
        let cal = Calendar.current
        let start = cal.dateInterval(of: .weekOfYear, for: day)?.start ?? day
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: start) }
    }
    private var dayEvents: [AgendaItem] { agenda(events, from: day, to: day.addingTimeInterval(86400)) }
    /// Each day's first three colours, from one lookup for the whole week instead of one per day.
    private var weekColors: [Date: [Color]] {
        guard let first = week.first, let last = week.last else { return [:] }
        let cal = Calendar.current
        var out: [Date: [Color]] = [:]
        for e in agenda(events, from: first, to: last.addingTimeInterval(86400)) {
            var d = cal.startOfDay(for: max(e.start, first))
            while d < e.end && d <= last {
                if out[d, default: []].count < 3 { out[d, default: []].append(e.color) }
                d = cal.date(byAdding: .day, value: 1, to: d) ?? e.end
            }
        }
        return out
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if dayEvents.isEmpty {
                        Text("Nothing scheduled").foregroundStyle(.tertiary).listRowBackground(Color.clear).listRowSeparator(.hidden)
                    }
                    ForEach(dayEvents) { a in
                        if let e = a.own {
                            Button { editing = e } label: { AgendaRow(item: a).foregroundStyle(.primary).contentShape(.rect) }
                                .buttonStyle(.plain)
                                // Long-press, like the web's right-click: recolor; Delete for good measure.
                                .contextMenu {
                                    Picker("Color", selection: Binding(get: { e.color }, set: { e.color = $0; PhoneLink.shared.sendAgenda() })) {
                                        ForEach(EventColor.all, id: \.name) { c in
                                            Label { Text(c.name.capitalized) } icon: { EventColor.dot(c.color) }.tag(c.name)
                                        }
                                    }
                                    .pickerStyle(.inline)
                                    Section { Button("Delete event", systemImage: "trash", role: .destructive) { e.trash(ctx) } }
                                }
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .swipeActions { Button(role: .destructive) { e.trash(ctx) } label: { Image(systemName: "trash") } }
                        } else {
                            AgendaRow(item: a).listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                        }
                    }
                } header: {
                    Text(Calendar.current.isDateInToday(day) ? "Today" : day.formatted(.dateTime.weekday(.wide).month().day()))
                        .font(.footnote.weight(.medium)).foregroundStyle(.secondary).textCase(nil)
                }
            }
            .compactList()
            // The week stays put above the day's list; swipe it for the next or last week.
            .safeAreaInset(edge: .top, spacing: 0) { weekStrip.padding(.horizontal, 12).padding(.bottom, 6).background(Theme.paper) }
            .navigationTitle(day.formatted(.dateTime.month(.wide).year()))
            .navigationBarTitleDisplayMode(.inline)
            .drawerButton()
            .toolbar {
                if !Calendar.current.isDateInToday(day) {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Today") { withAnimation(.snappy) { day = Calendar.current.startOfDay(for: .now) } }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) { CalendarsMenu() }
            }
            .sheet(item: $editing) { EventEditor(event: $0) }
            .sheet(isPresented: $creating) { EventEditor(event: nil, day: day) }
            .onChange(of: router.calendarDay, initial: true) {
                guard let date = router.calendarDay else { return }
                day = Calendar.current.startOfDay(for: date)
                router.calendarDay = nil
            }
            .onChange(of: router.newEvent, initial: true) {
                guard router.newEvent else { return }
                router.newEvent = false
                creating = true
            }
            .onAppear { router.onCalendar = true }
            .onDisappear { router.onCalendar = false }
        }
    }

    private var weekStrip: some View {
        let marks = weekColors
        return HStack(spacing: 0) {
            ForEach(week, id: \.self) { d in
                let on = Calendar.current.isDate(d, inSameDayAs: day)
                let today = Calendar.current.isDateInToday(d)
                Button { withAnimation(.snappy) { day = d } } label: {
                    VStack(spacing: 4) {
                        Text(d.formatted(.dateTime.weekday(.narrow))).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        Text(d.formatted(.dateTime.day()))
                            .font(.callout.weight(on || today ? .semibold : .regular).monospacedDigit())
                            .foregroundStyle(on ? Theme.paper : .primary)
                            .frame(width: 30, height: 30)
                            .background(on ? Color.primary : .clear, in: .circle)
                            .overlay { if today && !on { Circle().strokeBorder(.secondary, lineWidth: 1) } }
                        HStack(spacing: 2) {
                            ForEach(Array((marks[d] ?? []).enumerated()), id: \.offset) { Circle().fill($0.element).frame(width: 4, height: 4) }
                        }
                        .frame(height: 4)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .gesture(DragGesture().onEnded { v in
            let step = v.translation.width < -40 ? 7 : v.translation.width > 40 ? -7 : 0
            if step != 0 { withAnimation(.snappy) { day = Calendar.current.date(byAdding: .day, value: step, to: day)! } }
        })
    }

}

struct EventEditor: View {
    var event: Event?
    var day: Date = .now
    /// Exact start time, e.g. from tapping a slot in the week grid
    var at: Date? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var ctx
    @State private var title: String
    @State private var start: Date
    @State private var end: Date
    @State private var allDay: Bool
    @State private var location: String
    @State private var color: String
    @State private var notes: String
    @State private var linkedID: UUID?
    @Environment(Router.self) private var router
    @Environment(LectureRecorder.self) private var recorder
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }) private var items: [Item]
    private var linked: Item? { linkedID.flatMap { id in items.first { $0.id == id } } }

    init(event: Event?, day: Date = .now, at: Date? = nil) {
        self.event = event
        self.day = day
        self.at = at
        // Set up front, not in onAppear: filling these in later would count as the person moving the start time.
        var s = at ?? day
        if event == nil, at == nil {
            let cal = Calendar.current
            s = cal.date(bySettingHour: min(cal.component(.hour, from: .now) + 1, 23), minute: 0, second: 0, of: day) ?? day
        }
        _title = State(initialValue: event?.title ?? "")
        _start = State(initialValue: event?.start ?? s)
        // An all-day event is stored as midnight to midnight; show the last day it covers, like the web.
        let storedEnd = event?.end ?? s.addingTimeInterval(3600)
        _end = State(initialValue: event?.allDay == true ? max(storedEnd.addingTimeInterval(-86400), event!.start) : storedEnd)
        _allDay = State(initialValue: event?.allDay ?? false)
        _location = State(initialValue: event?.location ?? "")
        _color = State(initialValue: event?.color ?? "blue")
        _notes = State(initialValue: event?.notes ?? "")
        _linkedID = State(initialValue: event?.linkedItemID)
    }

    var body: some View {
        NavigationStack {
            // Same fields, same order as the web's event sheet.
            Form {
                TextField("Event title", text: $title).font(.title3)
                Section {
                    Toggle("All-day", isOn: $allDay).tint(Theme.local)
                    DatePicker("Starts", selection: $start, displayedComponents: allDay ? .date : [.date, .hourAndMinute])
                    DatePicker("Ends", selection: $end, in: start..., displayedComponents: allDay ? .date : [.date, .hourAndMinute])
                }
                Section {
                    Label { TextField("Add location", text: $location) } icon: { Image(systemName: "mappin").foregroundStyle(.secondary) }
                }
                Section { ColorSwatches(name: $color) }
                Section {
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...8)
                }
                Section("Linked") {
                    if let linked {
                        Button { save(); router.open(linked) } label: {
                            Label(linked.displayTitle, systemImage: linked.kind == .lecture ? "mic" : "doc.text")
                        }
                    } else {
                        HStack(spacing: 10) {
                            Button { link(.doc) } label: { Label("Notes", systemImage: "plus") }.buttonStyle(.bordered)
                            Button { link(.lecture) } label: { Label("Recording", systemImage: "mic") }.buttonStyle(.bordered)
                        }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                if let event {
                    Section {
                        Button("Delete event", systemImage: "trash", role: .destructive) { event.trash(ctx); dismiss() }
                    }
                }
            }
            .navigationTitle(event == nil ? "New event" : "Edit event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", role: .confirm) { save() }.disabled(title.trimmingCharacters(in: .whitespaces).isEmpty) }
            }
            // Moving the start keeps the length.
            .onChange(of: start) { o, n in end = end.addingTimeInterval(n.timeIntervalSince(o)) }
        }
        .presentationDetents([.medium, .large])
    }

    /// Starts a doc or recording for this event and opens it, like the web's Linked buttons.
    private func link(_ kind: ItemKind) {
        let t = title.trimmingCharacters(in: .whitespaces)
        let i = kind == .lecture ? Item(.lecture, title: t) : Item(.doc, title: t)
        ctx.insert(i)
        linkedID = i.id
        save()
        router.open(i)
        if kind == .lecture { recorder.start(i) }
    }

    private func save() {
        let e = event ?? Event(title: title, start: start, end: end)
        e.title = title.trimmingCharacters(in: .whitespaces); e.start = start; e.end = max(end, start); e.allDay = allDay
        if allDay {
            let cal = Calendar.current
            e.start = cal.startOfDay(for: start)
            e.end = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: max(end, start))) ?? e.start.addingTimeInterval(86400)
        }
        e.location = location.isEmpty ? nil : location
        e.color = color
        e.notes = notes.isEmpty ? nil : notes
        e.linkedItemID = linkedID
        if event == nil { ctx.insert(e) }
        PhoneLink.shared.sendAgenda()
        dismiss()
    }
}

/// A row in the day's agenda: time, a bar in the event's color, title.
struct AgendaRow: View {
    var item: AgendaItem
    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 1).fill(item.color).frame(width: 3, height: 18)
            Text(item.title).lineLimit(1)
                .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            Spacer(minLength: 8)
            Text(item.allDay ? "All day" : item.start.formatted(date: .omitted, time: .shortened))
                .font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
        }
        .opacity(item.end < .now ? 0.45 : 1)
    }
}

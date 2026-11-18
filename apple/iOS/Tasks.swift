import SwiftUI
import SwiftData

/// A task of its own, as on the web (`Task` in src/types.ts): not a line read out of a doc. A checklist in a doc stays
/// part of that doc. A task can name the doc it belongs with. Syncs to computers as a `task` record.
@Model
final class Todo {
    var id = UUID()
    var title = ""
    var done = false
    /// When it's due. All-day ones are due at the start of that day.
    var due: Date?
    var allDay = false
    var notes: String?
    /// The record id of the doc it belongs with (`Item.recID`).
    var docID: String?
    var createdAt = Date()
    var updatedAt = Date()
    var doneAt: Date?
    /// Id on linked computers, for tasks that started there.
    var syncID: String?

    init(title: String, due: Date? = nil, allDay: Bool = false, docID: String? = nil) {
        self.title = title
        self.due = due
        self.allDay = allDay
        self.docID = docID
    }

    var recID: String { syncID ?? id.uuidString.lowercased() }
    func touch() { updatedAt = .now }
}

enum Todos {
    /// A task from a typed line: the date words come out of the name ("essay draft by Friday" → "Essay draft", due Friday).
    /// Same reading as `readLine` in src/lib/tasks.ts.
    static func make(_ line: String, docID: String? = nil) -> Todo? {
        let text = line.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !text.isEmpty else { return nil }
        if let p = QuickAdd.parse(text) {
            let title = p.title.trimmingCharacters(in: .whitespaces)
            return Todo(title: title.isEmpty ? text : title, due: p.start, allDay: p.allDay, docID: docID)
        }
        return Todo(title: text, docID: docID)
    }

    /// Open tasks: dated ones first (soonest first), then the rest, newest first.
    static func open(_ all: [Todo]) -> [Todo] {
        let open = all.filter { !$0.done }
        return open.filter { $0.due != nil }.sorted { $0.due! < $1.due! } + open.filter { $0.due == nil }.sorted { $0.createdAt > $1.createdAt }
    }

    static func finished(_ all: [Todo]) -> [Todo] {
        all.filter(\.done).sorted { ($0.doneAt ?? $0.updatedAt) > ($1.doneAt ?? $1.updatedAt) }
    }

    static func setDone(_ t: Todo, _ done: Bool) {
        t.done = done
        t.doneAt = done ? .now : nil
        t.touch()
    }

    /// Check it off, with Undo. Home, Tasks and the hold menu all do it this way.
    static func complete(_ t: Todo) {
        Haptics.success()
        withAnimation(.snappy) { setDone(t, true) }
        Toaster.shared.show("Task done", action: ("Undo", { withAnimation(.snappy) { setDone(t, false) } }))
    }

    /// Delete it, with Undo (it comes back as it was).
    static func delete(_ t: Todo, in ctx: ModelContext) {
        let copy = (t.title, t.done, t.due, t.allDay, t.notes, t.docID, t.createdAt, t.doneAt, t.syncID ?? t.recID)
        withAnimation(.snappy) { ctx.delete(t) }
        Toaster.shared.show("Task deleted", action: ("Undo", {
            let n = Todo(title: copy.0, due: copy.2, allDay: copy.3, docID: copy.5)
            n.done = copy.1; n.notes = copy.4; n.createdAt = copy.6; n.doneAt = copy.7; n.syncID = copy.8
            withAnimation(.snappy) { ctx.insert(n) }
        }))
    }

    enum Group: String, CaseIterable {
        case overdue = "Overdue", today = "Today", week = "Next 7 days", later = "Later", someday = "No date"
    }

    static func group(_ t: Todo, now: Date = .now) -> Group {
        guard let due = t.due else { return .someday }
        let day = Calendar.current.startOfDay(for: now)
        // A timed task is overdue once the time passes; an all-day one when the day is over.
        if t.allDay ? due < day : due < now { return .overdue }
        if due < day.addingTimeInterval(86400) { return .today }
        if due < day.addingTimeInterval(8 * 86400) { return .week }
        return .later
    }

    /// "Today", "Tomorrow", "Fri", "Nov 28", with the time when it has one. Same as `dueLabel` on the web.
    static func label(_ t: Todo, now: Date = .now) -> String {
        guard let due = t.due else { return "" }
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: due)).day ?? 0
        let date = switch days {
        case 0: "Today"
        case 1: "Tomorrow"
        case -1: "Yesterday"
        case 2..<7: due.formatted(.dateTime.weekday(.abbreviated))
        default: due.formatted(.dateTime.month(.abbreviated).day())
        }
        return t.allDay ? date : "\(date) · \(due.formatted(date: .omitted, time: .shortened))"
    }

    /// Done tasks stay 30 days, then go.
    static func pruneDone(_ ctx: ModelContext) {
        let cutoff = Date.now.addingTimeInterval(-30 * 86400)
        guard let done = try? ctx.fetch(FetchDescriptor<Todo>(predicate: #Predicate { $0.done })) else { return }
        for t in done where (t.doneAt ?? t.updatedAt) < cutoff { ctx.delete(t) }
    }

    /// Once: open and done lines from the "Tasks" doc the app used to keep become tasks of their own, with the same ids
    /// the web gives them (`fromInboxDoc` in src/lib/tasks.ts), so a linked computer doing the same move merges with
    /// this one. If nothing else was in the doc it goes to Recently Deleted. Checklists in other docs stay put.
    static func moveInboxDoc(_ ctx: ModelContext) {
        let key = "tasks.movedInbox"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        let raw = ItemKind.doc.rawValue
        guard let docs = try? ctx.fetch(FetchDescriptor<Item>(predicate: #Predicate { $0.kindRaw == raw && $0.deletedAt == nil })),
              let inbox = docs.first(where: { $0.title.trimmingCharacters(in: .whitespaces).lowercased() == "tasks" }) else { return }
        var kept: [String] = []
        var n = 0
        for line in inbox.body.components(separatedBy: "\n") {
            guard let m = line.firstMatch(of: /^\s*[-*+] \[([ xX])\] (.*)$/) else { kept.append(line); continue }
            defer { n += 1 }
            let words = MD.plain(String(m.2)).trimmingCharacters(in: .whitespaces)
            guard !words.isEmpty else { continue }
            let done = m.1 != " "
            let at = inbox.updatedAt.addingTimeInterval(-Double(n) / 1000)
            let t = done ? Todo(title: words) : (make(words) ?? Todo(title: words))
            t.syncID = "\(inbox.recID)-\(n)"
            t.createdAt = at; t.updatedAt = at
            if done { t.done = true; t.doneAt = at }
            ctx.insert(t)
        }
        guard n > 0 else { return }
        let left = kept.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        inbox.body = left
        if left.isEmpty { inbox.deletedAt = .now }
        inbox.touch()
        try? ctx.save()
    }

    /// The starter tasks, with the web's ids so linking a computer merges them.
    static func seed(_ ctx: ModelContext) {
        let now = Date.now
        for (i, (id, title, doc)) in [("task-record", "Record a class or meeting and get notes written for you", nil as String?),
                                      ("task-watch", "Try the watch app: tap record on your wrist", nil)].enumerated() {
            let t = Todo(title: title, docID: doc)
            t.syncID = id
            t.createdAt = now.addingTimeInterval(-Double(i + 1))
            t.updatedAt = t.createdAt
            ctx.insert(t)
        }
    }
}

// MARK: - Rows

/// One task: a box to tick, its name, when it's due and the doc it goes with. Tap the name to edit it.
struct TodoRow: View {
    @Bindable var todo: Todo
    var showDoc = true
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }) private var items: [Item]
    @State private var editing = false

    private var doc: Item? { todo.docID.flatMap { id in items.first { $0.recID == id } } }

    var body: some View {
        HStack(spacing: 14) {
            Button {
                if todo.done { Haptics.tap(); withAnimation(.snappy) { Todos.setDone(todo, false) } } else { Todos.complete(todo) }
            } label: {
                Image(systemName: todo.done ? "checkmark.square.fill" : "square").font(.title3.weight(.light))
                    .foregroundStyle(todo.done ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 22, height: Space.row).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(todo.done ? "Not done: \(todo.title)" : "Mark done: \(todo.title)")

            Button { editing = true } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(todo.title.isEmpty ? "Untitled task" : todo.title)
                            .lineLimit(2).multilineTextAlignment(.leading)
                            .strikethrough(todo.done).foregroundStyle(todo.done ? .secondary : .primary)
                        if showDoc, let doc {
                            Label(doc.displayTitle, systemImage: "doc.text").labelStyle(.titleAndIcon)
                                .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                    if !todo.done, todo.due != nil {
                        Text(Todos.label(todo)).font(.footnote.monospacedDigit())
                            .foregroundStyle(Todos.group(todo) == .overdue ? Color.red : .secondary)
                    }
                }
                .padding(.vertical, 6)
                .frame(minHeight: Space.row).contentShape(.rect)
            }
            .buttonStyle(.row)
            .accessibilityHint("Edit task")
        }
        .contextMenu {
            Button(todo.done ? "Not done" : "Mark done", systemImage: "checkmark.square") {
                if todo.done { Todos.setDone(todo, false) } else { Todos.complete(todo) }
            }
            Button("Edit", systemImage: "pencil") { editing = true }
            if let doc { Button("Open \(doc.displayTitle)", systemImage: "doc.text") { router.open(doc) } }
            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = todo.title; Toaster.shared.show("Copied") }
            Divider()
            Button("Delete", systemImage: "trash", role: .destructive) { Todos.delete(todo, in: ctx) }
        }
        .sheet(isPresented: $editing) { TodoEditor(todo: todo) }
    }
}

/// A task opened to edit: its name, when it's due, the doc it goes with, notes. Saves as you go.
struct TodoEditor: View {
    @Bindable var todo: Todo
    @Environment(\.modelContext) private var ctx
    @Environment(\.dismiss) private var dismiss
    @Environment(Router.self) private var router
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.updatedAt, order: .reverse) private var items: [Item]

    private var hasDue: Binding<Bool> {
        Binding(get: { todo.due != nil }, set: { on in
            todo.due = on ? Calendar.current.startOfDay(for: .now) : nil
            todo.allDay = on
            todo.touch()
        })
    }
    private var hasTime: Binding<Bool> {
        Binding(get: { todo.due != nil && !todo.allDay }, set: { on in
            guard let d = todo.due else { return }
            let day = Calendar.current.startOfDay(for: d)
            todo.due = on ? Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: day) : day
            todo.allDay = !on
            todo.touch()
        })
    }
    private var due: Binding<Date> {
        Binding(get: { todo.due ?? .now }, set: { todo.due = todo.allDay ? Calendar.current.startOfDay(for: $0) : $0; todo.touch() })
    }
    private var docs: [Item] { items.filter { $0.kind == .doc } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Task", text: Binding(get: { todo.title }, set: { todo.title = $0; todo.touch() }), axis: .vertical)
                        .font(.title3.weight(.semibold))
                }
                Section {
                    Toggle("Due", isOn: hasDue)
                    if todo.due != nil {
                        DatePicker("Date", selection: due, displayedComponents: .date)
                        Toggle("Time", isOn: hasTime)
                        if !todo.allDay { DatePicker("Time", selection: due, displayedComponents: .hourAndMinute) }
                    }
                }
                Section {
                    Picker("Doc", selection: Binding(get: { todo.docID ?? "" }, set: { todo.docID = $0.isEmpty ? nil : $0; todo.touch() })) {
                        Text("None").tag("")
                        ForEach(docs) { d in Text(d.displayTitle).tag(d.recID) }
                    }
                    if let id = todo.docID, let d = items.first(where: { $0.recID == id }) {
                        Button("Open \(d.displayTitle)") { dismiss(); router.open(d) }
                    }
                }
                Section {
                    TextField("Notes", text: Binding(get: { todo.notes ?? "" }, set: { todo.notes = $0.isEmpty ? nil : $0; todo.touch() }), axis: .vertical)
                        .lineLimit(3...8)
                }
                Section {
                    Button("Delete task", role: .destructive) { dismiss(); Todos.delete(todo, in: ctx) }
                }
            }
            .navigationTitle(todo.done ? "Done" : "Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Screen

/// Tasks: a list of its own, grouped by when each is due. Type one in the row at the top ("essay draft by Friday").
/// Checked-off ones fold away at the bottom for 30 days.
struct TasksScreen: View {
    @Environment(Router.self) private var router
    @Environment(\.modelContext) private var ctx
    @Query private var todos: [Todo]
    @AppStorage("tasks.showDone") private var showDone = false
    @State private var draft = ""
    @FocusState private var typing: Bool

    var body: some View {
        let open = Todos.open(todos)
        let done = Todos.finished(todos)
        let now = Date.now
        let groups = Todos.Group.allCases.map { g in (g, open.filter { Todos.group($0, now: now) == g }) }.filter { !$0.1.isEmpty }
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    newRow
                    ForEach(groups, id: \.0) { g, list in
                        Panel(title: g.rawValue, tone: g == .overdue ? .red : .primary) {
                            Text("\(list.count)").monospacedDigit()
                        } content: {
                            ForEach(list) { TodoRow(todo: $0) }
                        }
                        .transition(.opacity)
                    }
                    if open.isEmpty {
                        WarmEmpty(title: "Nothing to do",
                                  message: "Type a task above. Put a date in it (\u{201C}essay draft by Friday\u{201D}) and it\u{2019}s sorted by when it\u{2019}s due.")
                    }
                    if !done.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Button { withAnimation(.snappy) { showDone.toggle() } } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                                        .rotationEffect(.degrees(showDone ? 90 : 0))
                                    Text("Done").font(.subheadline.weight(.semibold))
                                    Text("\(done.count)").font(.subheadline).foregroundStyle(.tertiary)
                                    Spacer()
                                }
                                .foregroundStyle(.secondary).frame(minHeight: 40).contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 4)
                            .accessibilityAddTraits(showDone ? .isSelected : [])
                            if showDone {
                                VStack(spacing: 0) { ForEach(done) { TodoRow(todo: $0) } }
                                    .padding(.horizontal, Space.card).padding(.vertical, 6)
                                    .panel()
                            }
                        }
                    }
                }
                .animation(.snappy, value: open.map(\.id))
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Space.page)
                .padding(.top, 4)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
            .paper()
            .navigationTitle("Tasks")
            .drawerButton()
            .navigationBarTitleDisplayMode(.large)
            .onAppear { if router.typeTask { router.typeTask = false; typing = true } }
            .onChange(of: router.typeTask) { if router.typeTask { router.typeTask = false; typing = true } }
        }
    }

    /// Type a task; a date in it ("by Friday", "tomorrow 3pm") sets when it's due.
    private var newRow: some View {
        HStack(spacing: 14) {
            Image(systemName: "plus.circle.fill").font(.title3).foregroundStyle(.tint)
                .frame(width: 22)
            TextField("New task", text: $draft)
                .focused($typing)
                .submitLabel(.done)
                .onSubmit(add)
            if !draft.isEmpty {
                Button("Add", action: add).font(.subheadline.weight(.semibold))
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, Space.card)
        .frame(minHeight: 54)
        .panel()
        .animation(.snappy(duration: 0.2), value: draft.isEmpty)
    }

    private func add() {
        let t = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let task = Todos.make(t) else { typing = false; return }
        withAnimation(.snappy) { ctx.insert(task) }
        draft = ""
        Haptics.success()
        if let _ = task.due { Toaster.shared.show("Added", detail: Todos.label(task)) }
        // The row stays ready for the next one.
        typing = true
    }
}

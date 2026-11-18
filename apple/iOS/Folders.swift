import SwiftUI
import SwiftData

/// Folders. A doc says which folder it's in (`Item.folder`, synced with computers); a folder you've made but not put
/// anything in yet is remembered here, so it doesn't vanish the moment you leave it.
enum Folders {
    static let key = "folders.empty"

    static func stored(_ raw: String) -> [String] { raw.split(separator: "\n").map(String.init) }

    /// Every folder: those docs are in, and the empty ones made here. Sorted by name.
    static func all(_ items: [Item], _ raw: String) -> [String] {
        Array(Set(items.filter { $0.deletedAt == nil }.compactMap(\.folder) + stored(raw))).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    private static var raw: String {
        get { UserDefaults.standard.string(forKey: key) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
    private static func setStored(_ names: [String]) { raw = Array(Set(names)).sorted().joined(separator: "\n") }

    static func create(_ name: String) {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return }
        setStored(stored(raw) + [n])
        Haptics.success()
    }

    static func rename(_ old: String, to new: String, in ctx: ModelContext) {
        let n = new.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty, n != old else { return }
        let docs = (try? ctx.fetch(FetchDescriptor<Item>(predicate: #Predicate { $0.folder == old }))) ?? []
        docs.forEach { $0.folder = n; $0.touch() }
        if stored(raw).contains(old) { setStored(stored(raw).filter { $0 != old } + [n]) }
    }

    /// Deletes the folder, with Undo. Its docs stay in Docs, just not filed.
    static func delete(_ name: String, in ctx: ModelContext) {
        let docs = (try? ctx.fetch(FetchDescriptor<Item>(predicate: #Predicate { $0.folder == name }))) ?? []
        let wasStored = stored(raw).contains(name)
        docs.forEach { $0.folder = nil; $0.touch() }
        setStored(stored(raw).filter { $0 != name })
        Haptics.thud()
        let n = docs.filter { $0.deletedAt == nil }.count
        Toaster.shared.show("Deleted \u{201C}\(name)\u{201D}", detail: n == 0 ? nil : "Its \(n == 1 ? "doc stays" : "\(n) docs stay") in Docs",
                            action: ("Undo", {
                                docs.forEach { $0.folder = name; $0.touch() }
                                if wasStored || docs.isEmpty { setStored(stored(raw) + [name]) }
                            }))
    }
}

/// A folder's hold menu: a new doc in it, rename it, or delete it (its docs stay in Docs), as on the web.
private struct FolderActions: ViewModifier {
    var name: String
    var onNewDoc: (Item) -> Void
    @Environment(\.modelContext) private var ctx
    @State private var renaming = false
    @State private var newName = ""

    func body(content: Content) -> some View {
        content
            .contextMenu {
                Button("New doc here", systemImage: "doc.badge.plus") { let d = Item(.doc); d.folder = name; ctx.insert(d); onNewDoc(d) }
                Button("Rename", systemImage: "pencil") { newName = name; renaming = true }
                Section { Button("Delete folder", systemImage: "trash", role: .destructive) { Folders.delete(name, in: ctx) } }
            }
            .folderRename(name, isPresented: $renaming, text: $newName)
    }
}

extension View {
    func folderActions(_ name: String, onNewDoc: @escaping (Item) -> Void) -> some View { modifier(FolderActions(name: name, onNewDoc: onNewDoc)) }

    /// The one rename prompt for a folder, wherever it's renamed from.
    func folderRename(_ name: String, isPresented: Binding<Bool>, text: Binding<String>) -> some View {
        modifier(FolderRename(name: name, isPresented: isPresented, text: text))
    }
}

private struct FolderRename: ViewModifier {
    var name: String
    @Binding var isPresented: Bool
    @Binding var text: String
    @Environment(\.modelContext) private var ctx
    @Environment(Router.self) private var router
    func body(content: Content) -> some View {
        content.alert("Rename folder", isPresented: $isPresented) {
            TextField("Name", text: $text)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                Folders.rename(name, to: text, in: ctx)
                router.showSection = .folder(text.trimmingCharacters(in: .whitespacesAndNewlines))
            }
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }
}

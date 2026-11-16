import SwiftUI
import SwiftData
import AppIntents
import CoreSpotlight
import UIKit

// Monolith from outside the app: Home Screen quick actions, Siri and Shortcuts (and the Action button), and
// Spotlight. Everything here stays on this iPhone: Spotlight's index is on-device, and with the app lock on
// nothing is indexed or offered to Siri at all.

/// Something to do as soon as the app is on screen.
enum SystemAction: Equatable {
    case newDoc, record, newEvent, ask(String), focusAsk, open(UUID)
}

// MARK: - Doing it

extension View {
    /// Runs `Router.shared.action` when one arrives (a quick action, Siri, a Spotlight result).
    func handlesSystemActions() -> some View { modifier(SystemActionHandler()) }
}

private struct SystemActionHandler: ViewModifier {
    @Environment(Router.self) private var router
    @Environment(LectureRecorder.self) private var recorder
    @Environment(\.modelContext) private var ctx
    @Environment(\.scenePhase) private var phase

    func body(content: Content) -> some View {
        content
            .onChange(of: router.action, initial: true) { run() }
            .onContinueUserActivity(CSSearchableItemActionType) { activity in
                guard let s = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String, let id = UUID(uuidString: s) else { return }
                router.action = .open(id)
            }
            .onChange(of: phase) { if phase == .background { Spotlight.refresh(ctx); QuickActions.refresh(ctx) } }
    }

    private func run() {
        guard let action = router.action else { return }
        router.action = nil
        switch action {
        case .newDoc:
            let item = Item(.doc)
            ctx.insert(item)
            router.open(item)
        case .record:
            guard !recorder.isRecording else { return Toaster.shared.show("Already recording") }
            let l = Item(.lecture, title: "Recording · \(Date.now.formatted(.dateTime.month(.abbreviated).day()))")
            ctx.insert(l)
            router.open(l)
            recorder.start(l)
            Haptics.success()
        case .newEvent:
            router.createEvent()
        case .ask(let q):
            router.ask = q
        case .focusAsk:
            router.focusAsk = true
        case .open(let id):
            let found = try? ctx.fetch(FetchDescriptor<Item>(predicate: #Predicate { $0.id == id && $0.deletedAt == nil })).first
            if let found { router.open(found) } else { Toaster.shared.show("That doc is gone", detail: "It may be in Recently Deleted.") }
        }
    }
}

// MARK: - Home Screen quick actions (hold the app icon)

enum QuickActions {
    static func handle(_ item: UIApplicationShortcutItem) {
        let action: SystemAction? = switch item.type {
        case "doc": .newDoc
        case "record": .record
        case "ask": .focusAsk
        case "event": .newEvent
        case "open": (item.userInfo?["id"] as? String).flatMap(UUID.init).map { .open($0) }
        default: nil
        }
        if let action { Task { @MainActor in Router.shared.action = action } }
    }

    /// The doc you were last in comes first, so picking up where you left off is one hold away.
    @MainActor static func refresh(_ ctx: ModelContext) {
        var latest = FetchDescriptor<Item>(predicate: #Predicate { $0.deletedAt == nil }, sortBy: [SortDescriptor(\.updatedAt, order: .reverse)])
        latest.fetchLimit = 1
        guard !AppLock.shared.enabled, let item = try? ctx.fetch(latest).first, !item.displayTitle.isEmpty else {
            UIApplication.shared.shortcutItems = []
            return
        }
        UIApplication.shared.shortcutItems = [
            UIApplicationShortcutItem(type: "open", localizedTitle: item.displayTitle, localizedSubtitle: "Continue",
                                      icon: UIApplicationShortcutIcon(systemImageName: item.kind == .lecture ? "waveform" : "doc.text"),
                                      userInfo: ["id": item.id.uuidString as NSString]),
        ]
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        // Opened from a quick action: do it once the app is on screen.
        if let item = options.shortcutItem { QuickActions.handle(item) }
        let config = UISceneConfiguration(name: nil, sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem) async -> Bool {
        QuickActions.handle(shortcutItem)
        return true
    }
}

// MARK: - Spotlight

/// Your docs and recordings in Spotlight search, on this iPhone only. Rebuilt when the app goes to the background,
/// which is cheap for a few hundred items. With the app lock on, the index is cleared instead.
enum Spotlight {
    private static let domain = "com.socratic.app.items"

    @MainActor static func refresh(_ ctx: ModelContext) {
        let index = CSSearchableIndex.default()
        guard !AppLock.shared.enabled else { index.deleteSearchableItems(withDomainIdentifiers: [domain]); return }
        let items = (try? ctx.fetch(FetchDescriptor<Item>(predicate: #Predicate { $0.deletedAt == nil }))) ?? []
        let entries = items.map { item in
            let attrs = CSSearchableItemAttributeSet(contentType: .text)
            attrs.title = item.displayTitle
            attrs.contentDescription = String(ItemPeek.readable(item.body).prefix(300))
            attrs.contentModificationDate = item.updatedAt
            return CSSearchableItem(uniqueIdentifier: item.id.uuidString, domainIdentifier: domain, attributeSet: attrs)
        }
        index.deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in index.indexSearchableItems(entries) }
    }
}

// MARK: - Siri, Shortcuts, the Action button

struct NewDocIntent: AppIntent {
    static let title: LocalizedStringResource = "New Doc"
    static let description = IntentDescription("Opens a new, empty doc.")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { Router.shared.action = .newDoc; return .result() }
}

struct StartRecordingIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Recording"
    static let description = IntentDescription("Starts recording right away and transcribes it on this iPhone.")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { Router.shared.action = .record; return .result() }
}

struct NewEventIntent: AppIntent {
    static let title: LocalizedStringResource = "New Event"
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { Router.shared.action = .newEvent; return .result() }
}

struct AskIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Monolith"
    static let description = IntentDescription("Asks the assistant, which answers from your docs on this iPhone.")
    static let openAppWhenRun = true
    @Parameter(title: "Question", requestValueDialog: "What would you like to ask?") var question: String
    @MainActor func perform() async throws -> some IntentResult { Router.shared.action = .ask(question); return .result() }
}

struct OpenDocIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Doc"
    static let openAppWhenRun = true
    @Parameter(title: "Doc") var doc: DocEntity
    @MainActor func perform() async throws -> some IntentResult { Router.shared.action = .open(doc.id); return .result() }
}

struct DocEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Doc"
    static let defaultQuery = DocQuery()
    var id: UUID
    var title: String
    var recording: Bool
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", image: .init(systemName: recording ? "waveform" : "doc.text"))
    }
}

/// Finds docs by name for Siri and Shortcuts. Nothing is offered while the app lock is on.
struct DocQuery: EntityStringQuery {
    @MainActor private func all(limit: Int = 200) -> [DocEntity] {
        guard !AppLock.shared.enabled else { return [] }
        var d = FetchDescriptor<Item>(predicate: #Predicate { $0.deletedAt == nil }, sortBy: [SortDescriptor(\.updatedAt, order: .reverse)])
        d.fetchLimit = limit
        return ((try? Storage.container.mainContext.fetch(d)) ?? []).map { DocEntity(id: $0.id, title: $0.displayTitle, recording: $0.kind == .lecture) }
    }
    @MainActor func entities(for identifiers: [UUID]) async throws -> [DocEntity] { all(limit: 2000).filter { identifiers.contains($0.id) } }
    @MainActor func entities(matching string: String) async throws -> [DocEntity] { all().filter { $0.title.localizedStandardContains(string) } }
    @MainActor func suggestedEntities() async throws -> [DocEntity] { Array(all(limit: 12)) }
}

struct MonolithShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskIntent(), phrases: ["Ask \(.applicationName)", "Ask \(.applicationName) a question"],
                    shortTitle: "Ask", systemImageName: "bubble.left")
        AppShortcut(intent: NewDocIntent(), phrases: ["New doc in \(.applicationName)", "Start a \(.applicationName) doc"],
                    shortTitle: "New Doc", systemImageName: "doc.text")
        AppShortcut(intent: StartRecordingIntent(), phrases: ["Record in \(.applicationName)", "Start a \(.applicationName) recording"],
                    shortTitle: "Record", systemImageName: "mic")
        AppShortcut(intent: OpenDocIntent(), phrases: ["Open \(\.$doc) in \(.applicationName)"],
                    shortTitle: "Open Doc", systemImageName: "doc")
        AppShortcut(intent: NewEventIntent(), phrases: ["New \(.applicationName) event"],
                    shortTitle: "New Event", systemImageName: "calendar.badge.plus")
    }
}

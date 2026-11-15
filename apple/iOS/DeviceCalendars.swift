import SwiftUI
import EventKit
import Observation

/// Event colors, the same names and shades as the web app.
enum EventColor {
    static let all: [(name: String, color: Color)] = [
        ("blue", Color(red: 0x3B / 255, green: 0x82 / 255, blue: 0xF6 / 255)),
        ("violet", Color(red: 0x8B / 255, green: 0x5C / 255, blue: 0xF6 / 255)),
        ("teal", Color(red: 0x14 / 255, green: 0xB8 / 255, blue: 0xA6 / 255)),
        ("green", Color(red: 0x22 / 255, green: 0xC5 / 255, blue: 0x5E / 255)),
        ("amber", Color(red: 0xF5 / 255, green: 0x9E / 255, blue: 0x0B / 255)),
        ("rose", Color(red: 0xF4 / 255, green: 0x3F / 255, blue: 0x5E / 255)),
        ("slate", Color(red: 0x64 / 255, green: 0x74 / 255, blue: 0x8B / 255)),
    ]
    /// A colored dot for menus, which otherwise draw every symbol in one tint.
    static func dot(_ color: Color) -> Image {
        let size = CGSize(width: 14, height: 14)
        let img = UIGraphicsImageRenderer(size: size).image { _ in
            UIColor(color).setFill()
            UIBezierPath(ovalIn: CGRect(origin: .zero, size: size)).fill()
        }
        return Image(uiImage: img.withRenderingMode(.alwaysOriginal))
    }
    static func color(_ name: String) -> Color { all.first { $0.name == name }?.color ?? all[0].color }
}

/// One thing on the calendar: yours, or from a calendar already on this iPhone (iCloud, Google, Outlook…).
struct AgendaItem: Identifiable {
    var id: String
    var title: String
    var start: Date
    var end: Date
    var allDay: Bool
    var location: String?
    var color: Color
    /// Set for your own events, which you can edit here. Others are changed in the app they belong to.
    var own: Event?
    var calendarName: String?

    init(_ e: Event) {
        id = e.id.uuidString; title = e.title; start = e.start; end = e.end; allDay = e.allDay
        location = e.location; color = EventColor.color(e.color); own = e
    }
    init(_ e: EKEvent) {
        id = (e.eventIdentifier ?? UUID().uuidString) + "\(e.startDate.timeIntervalSince1970)"
        title = e.title ?? "Busy"; start = e.startDate; end = e.endDate; allDay = e.isAllDay
        location = e.location; color = Color(cgColor: e.calendar.cgColor); calendarName = e.calendar.title
    }
}

/// The calendars already on this iPhone. Turned on once with one tap; after that they simply appear,
/// in their own colors, next to your events. Read-only.
@Observable
final class DeviceCalendars {
    static let shared = DeviceCalendars()
    private let store = EKEventStore()

    private(set) var on = UserDefaults.standard.bool(forKey: "deviceCalendars") && EKEventStore.authorizationStatus(for: .event) == .fullAccess
    private(set) var calendars: [EKCalendar] = []
    var hidden: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "hiddenCalendars") ?? []) {
        didSet { UserDefaults.standard.set(Array(hidden), forKey: "hiddenCalendars"); version += 1 }
    }
    /// Changes whenever the calendars do, so views re-read them.
    private(set) var version = 0

    private init() {
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            self?.reload()
        }
        reload()
    }

    func turnOn() async {
        let granted = (try? await store.requestFullAccessToEvents()) ?? false
        UserDefaults.standard.set(granted, forKey: "deviceCalendars")
        on = granted
        reload()
    }

    func turnOff() {
        UserDefaults.standard.set(false, forKey: "deviceCalendars")
        on = false
        version += 1
    }

    private func reload() {
        guard on else { return }
        calendars = store.calendars(for: .event).sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        version += 1
    }

    func events(from: Date, to: Date) -> [AgendaItem] {
        _ = version
        guard on else { return [] }
        let shown = calendars.filter { !hidden.contains($0.calendarIdentifier) }
        guard !shown.isEmpty else { return [] }
        return store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: shown)).map(AgendaItem.init)
    }
}

/// Your events plus the iPhone's, for a range of days.
func agenda(_ own: [Event], from: Date, to: Date) -> [AgendaItem] {
    (own.filter { $0.end > from && $0.start < to }.map(AgendaItem.init) + DeviceCalendars.shared.events(from: from, to: to))
        .sorted { ($0.allDay ? 0 : 1, $0.start) < ($1.allDay ? 0 : 1, $1.start) }
}

/// Color picker used by the event editor.
struct ColorSwatches: View {
    @Binding var name: String
    var body: some View {
        HStack(spacing: 12) {
            ForEach(EventColor.all, id: \.name) { c in
                Button { name = c.name } label: {
                    Circle().fill(c.color).frame(width: 26, height: 26)
                        .overlay(Circle().strokeBorder(.primary, lineWidth: name == c.name ? 2 : 0).padding(-4))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(c.name.capitalized)
                .accessibilityAddTraits(name == c.name ? .isSelected : [])
            }
        }
        .padding(.vertical, 6)
    }
}

/// Show or hide calendars. The iPhone's own calendars appear after one tap.
struct CalendarsMenu: View {
    private var device: DeviceCalendars { .shared }
    var body: some View {
        Menu {
            if device.on {
                Section("On this iPhone") {
                    ForEach(device.calendars, id: \.calendarIdentifier) { c in
                        Toggle(isOn: Binding(
                            get: { !device.hidden.contains(c.calendarIdentifier) },
                            set: { v in if v { device.hidden.remove(c.calendarIdentifier) } else { device.hidden.insert(c.calendarIdentifier) } }
                        )) { Label { Text(c.title) } icon: { Image(systemName: "circle.fill").foregroundStyle(Color(cgColor: c.cgColor)) } }
                    }
                }
                Button("Stop showing them", systemImage: "eye.slash") { device.turnOff() }
            } else {
                Button("Show my other calendars", systemImage: "calendar.badge.plus") { Task { await device.turnOn() } }
            }
        } label: { Image(systemName: "square.3.layers.3d") }
        .accessibilityLabel("Calendars")
    }
}

import SwiftUI
import CoreLocation
import MapKit
import WeatherKit

/// Services on this iPhone the assistant can draw on: where you are, the weather there, travel time to your next
/// event, and the places you spend time. Each is off until you turn it on. What it learns stays on the device;
/// weather and travel times ask Apple's services about your area.
@Observable
final class Integrations: NSObject, CLLocationManagerDelegate {
    static let shared = Integrations()

    enum Kind: String, CaseIterable, Identifiable {
        case location, weather, maps, history
        var id: String { rawValue }
        var title: String {
            switch self {
            case .location: "Location"
            case .weather: "Weather"
            case .maps: "Maps"
            case .history: "Location history"
            }
        }
        /// What it gives the assistant, in one line.
        var detail: String {
            switch self {
            case .location: "Where you are, so answers can be about here."
            case .weather: "Today’s forecast for your plan and answers."
            case .maps: "Travel time to your next event with a place."
            case .history: "Places you spend time, kept only on this iPhone."
            }
        }
        var symbol: String {
            switch self {
            case .location: "location"
            case .weather: "cloud.sun"
            case .maps: "map"
            case .history: "clock.arrow.circlepath"
            }
        }
        /// Everything else needs to know where you are.
        var needsLocation: Bool { self != .location }
    }

    struct Weather: Equatable {
        var temperature: String
        var condition: String
        var symbol: String
        var high: String
        var low: String
        var rain: Int
        var line: String { "\(temperature) \(condition)" }
    }

    struct Trip: Equatable {
        var event: String
        var place: String
        var start: Date
        var minutes: Int
        var walking: Bool
        var leaveBy: Date { start.addingTimeInterval(-Double(minutes + 5) * 60) }
        var line: String { "\(minutes) min \(walking ? "walk" : "drive")" }
    }

    struct Visit: Codable, Identifiable, Equatable {
        var id = UUID()
        var latitude: Double
        var longitude: Double
        var arrived: Date
        var departed: Date?
        var name: String?
    }

    // MARK: State

    private(set) var enabled: Set<Kind>
    private(set) var authorization: CLAuthorizationStatus
    private(set) var place: String?
    private(set) var here: CLLocation?
    private(set) var weather: Weather?
    private(set) var weatherFailed = false
    private(set) var trip: Trip?
    private(set) var visits: [Visit] = []
    private(set) var attribution: (light: URL, dark: URL, legal: URL)?
    private(set) var updatedAt: Date?

    private let manager = CLLocationManager()
    /// A switch turned on before permission was answered: finished once the answer comes.
    private var waitingFor: Kind?
    private var nextEvents: [(title: String, place: String, start: Date)] = []

    private override init() {
        enabled = Set((UserDefaults.standard.stringArray(forKey: "integrations") ?? []).compactMap(Kind.init(rawValue:)))
        authorization = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        visits = Self.loadVisits()
        if enabled.contains(.history), authorization == .authorizedAlways { manager.startMonitoringVisits() }
    }

    func isOn(_ kind: Kind) -> Bool { enabled.contains(kind) && (!kind.needsLocation || allowed) }
    var allowed: Bool { authorization == .authorizedWhenInUse || authorization == .authorizedAlways }
    var denied: Bool { authorization == .denied || authorization == .restricted }
    /// History needs "Always"; the others are fine with "While Using".
    var historyDenied: Bool { enabled.contains(.history) && allowed && authorization != .authorizedAlways && waitingFor == nil }
    /// A system permission prompt is open (or about to be): the screen holds its warnings until it's answered.
    var asking: Bool { waitingFor != nil }

    // MARK: Switching

    func set(_ kind: Kind, on: Bool) {
        if !on {
            enabled.remove(kind)
            // Location is what the others stand on.
            if kind == .location { enabled.subtract([.weather, .maps, .history]) }
            if !enabled.contains(.history) { manager.stopMonitoringVisits() }
            save()
            return
        }
        enabled.insert(kind)
        if kind.needsLocation { enabled.insert(.location) }
        save()
        switch authorization {
        case .notDetermined:
            waitingFor = kind
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse where kind == .history:
            waitingFor = kind
            manager.requestAlwaysAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            if kind == .history { manager.startMonitoringVisits() }
            refresh(force: true)
        default:
            break  // Denied: the screen offers Settings.
        }
    }

    private func save() {
        UserDefaults.standard.set(enabled.map(\.rawValue).sorted(), forKey: "integrations")
    }

    /// Next events that have a place, so Maps can work out the trip. Called by Home with what's on the calendar.
    func upcoming(_ events: [(title: String, place: String, start: Date)]) {
        let soon = events.filter { $0.start > .now && $0.start < .now.addingTimeInterval(12 * 3600) && !$0.place.isEmpty }
            .sorted { $0.start < $1.start }
        guard soon.map(\.title) != nextEvents.map(\.title) || soon.first?.start != nextEvents.first?.start else { return }
        nextEvents = soon
        if isOn(.maps) { Task { await updateTrip() } }
    }

    /// Fresh location (and with it weather and travel time), at most every ten minutes unless forced.
    func refresh(force: Bool = false) {
        guard allowed, enabled.contains(.location) else { return }
        if !force, let updatedAt, Date.now.timeIntervalSince(updatedAt) < 600 { return }
        manager.requestLocation()
    }

    // MARK: Location history

    var recentPlaces: [(name: String, visits: [Visit])] {
        let week = Date.now.addingTimeInterval(-7 * 86400)
        let named = visits.filter { $0.arrived > week }.map { v in (v.name ?? "Unnamed place", v) }
        let grouped = Dictionary(grouping: named, by: \.0).mapValues { $0.map(\.1) }
        return grouped.map { (name: $0.key, visits: $0.value.sorted { $0.arrived > $1.arrived }) }
            .sorted { ($0.visits.first?.arrived ?? .distantPast) > ($1.visits.first?.arrived ?? .distantPast) }
    }

    func clearHistory() {
        visits = []
        Self.saveVisits(visits)
    }

    private static var visitsURL: URL {
        let dir = URL.applicationSupportDirectory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appending(path: "visits.json")
    }
    private static func loadVisits() -> [Visit] {
        (try? JSONDecoder().decode([Visit].self, from: Data(contentsOf: visitsURL))) ?? []
    }
    private static func saveVisits(_ v: [Visit]) {
        guard let data = try? JSONEncoder().encode(v) else { return }
        // Protected while the phone is locked, like the rest of your notes.
        try? data.write(to: visitsURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    // MARK: For the assistant

    /// One short block of what the turned-on integrations know, added to the assistant's material.
    var context: String {
        var lines: [String] = []
        if isOn(.location), let place { lines.append("Location: near \(place)") }
        if isOn(.weather), let w = weather {
            lines.append("Weather now: \(w.line). Today: high \(w.high), low \(w.low), \(w.rain)% chance of rain.")
        }
        if isOn(.maps), let t = trip {
            lines.append("Travel: \(t.event) at \(t.place) starts \(t.start.formatted(date: .omitted, time: .shortened)); it's about a \(t.line) from here, so leave by \(t.leaveBy.formatted(date: .omitted, time: .shortened)).")
        }
        if isOn(.history), !recentPlaces.isEmpty {
            let places = recentPlaces.prefix(6).map { p in
                let last = p.visits[0]
                return "\(p.name) (\(p.visits.count)×, last \(last.arrived.formatted(.dateTime.weekday(.abbreviated).hour().minute())))"
            }
            lines.append("Places this week: \(places.joined(separator: "; "))")
        }
        return lines.isEmpty ? "" : "From this iPhone:\n" + lines.joined(separator: "\n")
    }

    // MARK: Lookups

    private func didLocate(_ location: CLLocation) async {
        here = location
        updatedAt = .now
        place = await Self.name(of: location, short: true)
        async let w: Void = isOn(.weather) ? updateWeather() : ()
        async let t: Void = isOn(.maps) ? updateTrip() : ()
        _ = await (w, t)
    }

    private func updateWeather() async {
        guard let here else { return }
        do {
            let (now, days) = try await WeatherService.shared.weather(for: here, including: .current, .daily)
            let style = Measurement<UnitTemperature>.FormatStyle(width: .narrow, usage: .weather, numberFormatStyle: .number.precision(.fractionLength(0)))
            let today = days.first
            weather = Weather(temperature: now.temperature.formatted(style), condition: now.condition.description,
                              symbol: now.symbolName,
                              high: today.map { $0.highTemperature.formatted(style) } ?? "–",
                              low: today.map { $0.lowTemperature.formatted(style) } ?? "–",
                              rain: Int(((today?.precipitationChance ?? 0) * 100).rounded()))
            weatherFailed = false
            if attribution == nil, let a = try? await WeatherService.shared.attribution {
                attribution = (a.combinedMarkLightURL, a.combinedMarkDarkURL, a.legalPageURL)
            }
        } catch {
            weatherFailed = true
        }
    }

    private func updateTrip() async {
        guard let here, let next = nextEvents.first else { trip = nil; return }
        let search = MKLocalSearch.Request()
        search.naturalLanguageQuery = next.place
        search.region = MKCoordinateRegion(center: here.coordinate, latitudinalMeters: 50_000, longitudinalMeters: 50_000)
        guard let target = try? await MKLocalSearch(request: search).start().mapItems.first else { trip = nil; return }
        let distance = target.location.distance(from: here)
        let walking = distance < 2_000
        let route = MKDirections.Request()
        route.source = MKMapItem.forCurrentLocation()
        route.destination = target
        route.transportType = walking ? .walking : .automobile
        guard let eta = try? await MKDirections(request: route).calculateETA() else { trip = nil; return }
        trip = Trip(event: next.title, place: target.name ?? next.place, start: next.start,
                    minutes: max(1, Int((eta.expectedTravelTime / 60).rounded())), walking: walking)
    }

    /// "Mission District" for a neighbourhood, or the place's name when it has one.
    private static func name(of location: CLLocation, short: Bool) async -> String? {
        guard let request = MKReverseGeocodingRequest(location: location),
              let item = try? await request.mapItems.first else { return nil }
        if short { return item.addressRepresentations?.cityWithContext ?? item.addressRepresentations?.cityName ?? item.name }
        return item.name ?? item.address?.shortAddress ?? item.addressRepresentations?.cityName
    }

    // MARK: CLLocationManagerDelegate (called on the main thread, where the manager was made)

    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        Task { @MainActor in
            authorization = m.authorizationStatus
            guard let kind = waitingFor, authorization != .notDetermined else {
                if allowed { refresh() }
                return
            }
            waitingFor = nil
            if kind == .history, authorization == .authorizedWhenInUse {
                // "While Using" came first; history also needs "Always".
                waitingFor = .history
                m.requestAlwaysAuthorization()
                return
            }
            if authorization == .authorizedAlways, enabled.contains(.history) { m.startMonitoringVisits() }
            if allowed { refresh(force: true) }
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        Task { @MainActor in await didLocate(last) }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didFailWithError error: any Error) {}

    nonisolated func locationManager(_ m: CLLocationManager, didVisit visit: CLVisit) {
        let lat = visit.coordinate.latitude, lon = visit.coordinate.longitude
        let arrived = visit.arrivalDate == .distantPast ? Date.now : visit.arrivalDate
        let departed = visit.departureDate == .distantFuture ? nil : visit.departureDate
        Task { @MainActor in
            guard enabled.contains(.history) else { return }
            let name = await Self.name(of: CLLocation(latitude: lat, longitude: lon), short: false)
            // A departure updates the arrival it belongs to.
            if let i = visits.firstIndex(where: { abs($0.latitude - lat) < 0.0005 && abs($0.longitude - lon) < 0.0005 && $0.departed == nil }) {
                visits[i].departed = departed
                if visits[i].name == nil { visits[i].name = name }
            } else {
                visits.append(Visit(latitude: lat, longitude: lon, arrived: arrived, departed: departed, name: name))
            }
            // Thirty days is plenty of context; older places are let go.
            let cutoff = Date.now.addingTimeInterval(-30 * 86400)
            visits = Array(visits.filter { $0.arrived > cutoff }.suffix(500))
            Self.saveVisits(visits)
        }
    }
}

// MARK: - Screen

/// Sidebar → Integrations: one card per service, each with its own switch and what it currently knows.
struct IntegrationsView: View {
    @State private var places = false
    @State private var confirmClear = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL
    private var model: Integrations { .shared }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.section) {
                    Text("Let the assistant use what this iPhone knows. Each one stays off until you turn it on.")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .padding(.horizontal, 4)

                    // Only a full "no" gets a notice up here; history's own "needs Always" lives in its card.
                    if model.denied {
                        notice("Location is off for Monolith", "Turn it on in Settings to use these.")
                    }

                    VStack(spacing: 12) {
                        ForEach(Integrations.Kind.allCases) { card($0) }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        footnote("Your location and places are kept only on this iPhone.", "lock")
                        footnote("Weather and travel times ask Apple’s services about your area.", "network")
                        if let a = model.attribution {
                            HStack(spacing: 8) {
                                AsyncImage(url: scheme == .dark ? a.dark : a.light) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
                                    .frame(height: 12)
                                SwiftUI.Link("Data sources", destination: a.legal)
                            }
                        }
                    }
                    .font(.footnote).foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
                }
                .padding(.horizontal, Space.page)
                .padding(.top, 12)
                .padding(.bottom, 120)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .paper()
            .navigationTitle("Integrations")
            .navigationBarTitleDisplayMode(.inline)
            .drawerButton()
            .onAppear { model.refresh() }
            .sheet(isPresented: $places) { PlacesView() }
            .confirmationDialog("Clear location history?", isPresented: $confirmClear, titleVisibility: .visible) {
                Button("Clear history", role: .destructive) { model.clearHistory(); Toaster.shared.show("Location history cleared") }
            } message: { Text("Every place Monolith has saved is removed. This can’t be undone.") }
        }
    }

    private func card(_ kind: Integrations.Kind) -> some View {
        let on = model.enabled.contains(kind)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Image(systemName: kind.symbol).font(.body)
                    .frame(width: 40, height: 40)
                    .background(Theme.tile, in: .rect(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(kind.title).font(.body.weight(.semibold))
                    Text(kind.detail).font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Toggle(kind.title, isOn: Binding(get: { on }, set: { model.set(kind, on: $0) }))
                    .labelsHidden()
                    .tint(Theme.local)  // the app tint is white, which hides the knob; "on" is a status, so green
            }
            if on, let status = status(kind) {
                HStack(spacing: 8) {
                    Image(systemName: status.symbol).font(.footnote).frame(width: 16)
                    Text(status.text).font(.subheadline)
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14).padding(.vertical, 10).frame(minHeight: 40)
                .background(Theme.tile, in: .rect(cornerRadius: 14, style: .continuous))
            }
            if on, kind == .history, model.historyDenied {
                pill("Open Settings", primary: true) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
            } else if on, kind == .history, model.isOn(.history) {
                HStack(spacing: 8) {
                    pill("See places", primary: false) { places = true }
                    pill("Clear history", primary: false) { confirmClear = true }
                        .disabled(model.visits.isEmpty)
                }
            }
        }
        .padding(Space.card)
        .background(Theme.card, in: .rect(cornerRadius: 24, style: .continuous))
        .animation(.snappy, value: on)
    }

    /// What each one knows right now, or why it doesn't yet.
    private func status(_ kind: Integrations.Kind) -> (symbol: String, text: String)? {
        if model.denied { return ("exclamationmark.circle", "Needs location access") }
        if !model.allowed || model.asking { return ("hourglass", "Waiting for permission") }
        switch kind {
        case .location:
            return ("location.fill", model.place.map { "Near \($0)" } ?? "Finding where you are…")
        case .weather:
            if model.weatherFailed { return ("exclamationmark.circle", "Weather isn’t available right now") }
            return model.weather.map { ($0.symbol, "\($0.line) · H \($0.high) L \($0.low)") } ?? ("hourglass", "Getting the forecast…")
        case .maps:
            return model.trip.map { ("figure.walk", "\($0.event): \($0.line), leave by \($0.leaveBy.formatted(date: .omitted, time: .shortened))") }
                ?? ("calendar", "Add a place to an event to see travel time")
        case .history:
            if model.historyDenied { return ("exclamationmark.circle", "Needs “Always” location access") }
            let n = model.recentPlaces.count
            return ("mappin.and.ellipse", n == 0 ? "Places appear as you spend time somewhere" : "\(n) place\(n == 1 ? "" : "s") this week")
        }
    }

    private func footnote(_ text: String, _ symbol: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: symbol).frame(width: 18)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func notice(_ title: String, _ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.body.weight(.semibold))
                Text(message).font(.subheadline).foregroundStyle(.secondary)
            }
            pill("Open Settings", primary: true) {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Space.card)
        .background(Theme.card, in: .rect(cornerRadius: 24, style: .continuous))
    }

    private func pill(_ title: String, primary: Bool, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(title).font(.subheadline.weight(.semibold))
                .padding(.horizontal, 16).frame(height: 38)
                .foregroundStyle(primary ? Theme.paper : .primary)
                .background(primary ? Color.primary : Theme.wash, in: .capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
    }
}

/// The places Location history has noted this week, most recent first.
private struct PlacesView: View {
    @Environment(\.dismiss) private var dismiss
    private var model: Integrations { .shared }
    var body: some View {
        NavigationStack {
            List {
                ForEach(model.recentPlaces, id: \.name) { place in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(place.name)
                        Text(place.visits.prefix(3).map { v in
                            v.arrived.formatted(.dateTime.weekday(.abbreviated).hour().minute())
                        }.joined(separator: " · "))
                        .font(.footnote).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .paper()
            .overlay {
                if model.recentPlaces.isEmpty {
                    EmptyState(symbol: "mappin.and.ellipse", title: "No places yet", message: "Places you spend time this week show up here.")
                }
            }
            .navigationTitle("Places this week")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

import SwiftUI
import UIKit

/// The web app's looks on iPhone and iPad (`src/lib/looks.ts`, `[data-look]` in `src/soft.css`): a soft wash of
/// color behind every screen, an accent for buttons, checkboxes, today and selection, and the material panels are
/// made of. Chosen in Settings › Appearance and once during setup.
struct Look: Identifiable, Hashable {
    let id: String
    let name: String
    /// The three wash colors: top-left, bottom-right, top-right.
    let colors: [UInt32]
    /// The look's own accent (dark shade, light shade), used when the accent is "Match the look".
    let accent: (dark: UInt32, light: UInt32)?

    static func == (a: Look, b: Look) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    static let all: [Look] = [
        Look(id: "graphite", name: "Graphite", colors: [], accent: nil),
        Look(id: "dusk", name: "Dusk", colors: [0x6E56CF, 0xD6409F, 0x3E63DD], accent: (0x9B7BFF, 0x6D4FD8)),
        Look(id: "tide", name: "Tide", colors: [0x0090FF, 0x12A594, 0x6E56CF], accent: (0x4C9DFF, 0x1D6FD6)),
        Look(id: "moss", name: "Moss", colors: [0x30A46C, 0x8DB654, 0x12A594], accent: (0x4CC38A, 0x1F8A52)),
        Look(id: "ember", name: "Ember", colors: [0xF76B15, 0xE54666, 0xFFB224], accent: (0xFF8A3D, 0xC2500A)),
        Look(id: "bloom", name: "Bloom", colors: [0xD6409F, 0x8E4EC6, 0xF76B15], accent: (0xFF6BB5, 0xC02F86)),
        Look(id: "aurora", name: "Aurora", colors: [0x30A46C, 0x6E56CF, 0x0090FF], accent: (0x5FD4A0, 0x1F8A52)),
    ]
    static func of(_ id: String) -> Look { all.first { $0.id == id } ?? all[1] }
    var plain: Bool { colors.isEmpty }
}

struct Tint: Identifiable, Hashable {
    let id: String
    let name: String
    let shades: (dark: UInt32, light: UInt32)?

    static func == (a: Tint, b: Tint) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    static let all: [Tint] = [
        Tint(id: "mono", name: "Neutral", shades: nil),
        Tint(id: "look", name: "Match the look", shades: nil),
        Tint(id: "blue", name: "Blue", shades: (0x4C8DFF, 0x2563EB)),
        Tint(id: "violet", name: "Violet", shades: (0x9B7BFF, 0x6D4FD8)),
        Tint(id: "teal", name: "Teal", shades: (0x2EC4B6, 0x0F7F76)),
        Tint(id: "green", name: "Green", shades: (0x4CC38A, 0x1F8A52)),
        Tint(id: "amber", name: "Amber", shades: (0xF5A524, 0xA35F00)),
        Tint(id: "rose", name: "Rose", shades: (0xFF6B8B, 0xD23B62)),
    ]
    static func of(_ id: String) -> Tint { all.first { $0.id == id } ?? all[1] }
}

/// What panels are made of: Clear lets the most wash through, Solid none.
enum Surface: String, CaseIterable, Identifiable {
    case clear, frosted, solid
    var id: String { rawValue }
    var name: String { rawValue.capitalized }
}

enum Appearance {
    static let lookKey = "look", tintKey = "tint", surfaceKey = "surface"
    static let defaultLook = "dusk", defaultTint = "look", defaultSurface = Surface.frosted.rawValue

    static func color(_ v: UInt32) -> Color {
        Color(red: Double(v >> 16 & 0xFF) / 255, green: Double(v >> 8 & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
    static func pair(_ shades: (dark: UInt32, light: UInt32)) -> Color {
        Color(UIColor { t in
            let v = t.userInterfaceStyle == .dark ? shades.dark : shades.light
            return UIColor(red: CGFloat(v >> 16 & 0xFF) / 255, green: CGFloat(v >> 8 & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
        })
    }

    /// The accent for this look and tint. Neutral is the text color, as on the web.
    static func accent(look: String, tint: String) -> Color {
        let t = Tint.of(tint)
        if let s = t.shades { return pair(s) }
        if t.id == "look", let s = Look.of(look).accent { return pair(s) }
        return .primary
    }
}

/// Three colors blooming from the corners over the page color, like the web's `.app` background. Graphite is the
/// plain page. Drawn once per screen, pinned to the window, so moving between screens the color stays put.
struct Wash: View {
    @AppStorage(Appearance.lookKey) private var lookID = Appearance.defaultLook
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = Look.of(lookID)
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let dark = scheme == .dark
            let strength: [Double] = dark ? [0.46, 0.34, 0.24] : [0.30, 0.22, 0.16]
            ZStack {
                Theme.paper
                if !look.plain {
                    Appearance.color(look.colors[0]).opacity(dark ? 0.06 : 0.04)
                    bloom(look.colors[0], strength[0], at: UnitPoint(x: -0.08, y: -0.10), radius: max(w, h) * 0.85)
                    bloom(look.colors[1], strength[1], at: UnitPoint(x: 1.08, y: 1.08), radius: max(w, h) * 0.8)
                    bloom(look.colors[2], strength[2], at: UnitPoint(x: 0.96, y: -0.06), radius: max(w, h) * 0.6)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// One color fading out from a point (which may sit past the edge), across the whole screen so it has no seams.
    private func bloom(_ c: UInt32, _ a: Double, at p: UnitPoint, radius: CGFloat) -> some View {
        RadialGradient(stops: [.init(color: Appearance.color(c).opacity(a), location: 0),
                               .init(color: Appearance.color(c).opacity(a * 0.45), location: 0.45),
                               .init(color: Appearance.color(c).opacity(0), location: 1)],
                       center: p, startRadius: 0, endRadius: radius)
    }
}

/// A card or panel on the page: frosted over a look, a quiet solid on Graphite. One hairline edge, no shadow.
private struct PanelStyle: ViewModifier {
    var radius: CGFloat
    @AppStorage(Appearance.lookKey) private var lookID = Appearance.defaultLook
    @AppStorage(Appearance.surfaceKey) private var surface = Appearance.defaultSurface
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background {
                if Look.of(lookID).plain || surface == Surface.solid.rawValue {
                    shape.fill(Theme.card)
                } else if surface == Surface.clear.rawValue {
                    shape.fill(.ultraThinMaterial).opacity(0.85)
                } else {
                    shape.fill(.thinMaterial)
                }
            }
            .overlay { shape.strokeBorder(Color.primary.opacity(scheme == .dark ? 0.08 : 0.06), lineWidth: 1) }
            .clipShape(shape)
    }
}

extension View {
    /// A panel on the page (Home's Tasks and Calendar, doc cards, a group of tasks).
    func panel(radius: CGFloat = 22) -> some View { modifier(PanelStyle(radius: radius)) }

    /// Applies the chosen accent to everything inside.
    func lookTint() -> some View { modifier(LookTint()) }
}

private struct LookTint: ViewModifier {
    @AppStorage(Appearance.lookKey) private var lookID = Appearance.defaultLook
    @AppStorage(Appearance.tintKey) private var tintID = Appearance.defaultTint
    func body(content: Content) -> some View { content.tint(Appearance.accent(look: lookID, tint: tintID)) }
}

// MARK: - Settings › Appearance

/// Looks as small washes, accents as dots, surfaces as three choices, light and dark. Same as the web's.
struct AppearancePicker: View {
    @AppStorage(Appearance.lookKey) private var lookID = Appearance.defaultLook
    @AppStorage(Appearance.tintKey) private var tintID = Appearance.defaultTint
    @AppStorage(Appearance.surfaceKey) private var surface = Appearance.defaultSurface
    @AppStorage("appearance") private var mode = "dark"
    /// Setup shows only the looks.
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if !compact {
                Picker("Mode", selection: $mode) {
                    Text("Dark").tag("dark"); Text("Light").tag("light"); Text("System").tag("system")
                }
                .pickerStyle(.segmented)
            }
            LookGrid(selection: $lookID)
            if !compact {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Accent").groupLabel()
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(Tint.all) { t in
                                Button { withAnimation(.snappy) { tintID = t.id }; Haptics.tap() } label: { dot(t) }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(t.name)
                                    .accessibilityAddTraits(tintID == t.id ? .isSelected : [])
                            }
                        }
                        .padding(.vertical, 4).padding(.horizontal, 2)
                    }
                    Text(Tint.of(tintID).name).font(.footnote).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text("Surface").groupLabel()
                    Picker("Surface", selection: $surface) {
                        ForEach(Surface.allCases) { Text($0.name).tag($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                    .disabled(Look.of(lookID).plain)
                    Text(Look.of(lookID).plain ? "Surfaces show over a look with color." : "How much of the look shows through cards and panels.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func dot(_ t: Tint) -> some View {
        let c = Appearance.accent(look: lookID, tint: t.id)
        return ZStack {
            Circle().fill(t.id == "mono" ? AnyShapeStyle(Color.primary) : AnyShapeStyle(c)).frame(width: 30, height: 30)
            if t.id == "look" { Image(systemName: "sparkles").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.paper) }
        }
        .padding(4)
        .overlay { Circle().strokeBorder(Color.primary.opacity(tintID == t.id ? 0.9 : 0), lineWidth: 2) }
    }
}

/// The looks as small swatches of their own wash.
struct LookGrid: View {
    @Binding var selection: String
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 12)], spacing: 12) {
            ForEach(Look.all) { l in
                Button { withAnimation(.snappy) { selection = l.id }; Haptics.tap() } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        swatch(l)
                            .frame(height: 64)
                            .clipShape(.rect(cornerRadius: 16, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .strokeBorder(selection == l.id ? Color.primary : Color.primary.opacity(0.1), lineWidth: selection == l.id ? 2 : 1)
                            }
                        Text(l.name).font(.footnote.weight(selection == l.id ? .semibold : .regular))
                            .foregroundStyle(selection == l.id ? .primary : .secondary)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == l.id ? .isSelected : [])
            }
        }
    }

    @ViewBuilder private func swatch(_ l: Look) -> some View {
        if l.plain {
            Theme.card
        } else {
            ZStack {
                Theme.paper
                RadialGradient(colors: [Appearance.color(l.colors[0]).opacity(0.75), .clear], center: .topLeading, startRadius: 0, endRadius: 90)
                RadialGradient(colors: [Appearance.color(l.colors[1]).opacity(0.6), .clear], center: .bottomTrailing, startRadius: 0, endRadius: 90)
                RadialGradient(colors: [Appearance.color(l.colors[2]).opacity(0.45), .clear], center: .topTrailing, startRadius: 0, endRadius: 70)
            }
        }
    }
}

struct AppearanceView: View {
    @AppStorage(Appearance.lookKey) private var lookID = Appearance.defaultLook
    @AppStorage(Appearance.tintKey) private var tintID = Appearance.defaultTint
    var body: some View {
        ScrollView {
            AppearancePicker().padding(Space.page)
        }
        // The watch wears the same look.
        .onChange(of: lookID) { PhoneLink.shared.sendAgenda() }
        .onChange(of: tintID) { PhoneLink.shared.sendAgenda() }
        .paper()
        .navigationTitle("Appearance")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The chosen look as a small round swatch (Settings).
struct LookDot: View {
    @AppStorage(Appearance.lookKey) private var lookID = Appearance.defaultLook
    var body: some View {
        let l = Look.of(lookID)
        Circle()
            .fill(l.plain ? AnyShapeStyle(Theme.card) : AnyShapeStyle(AngularGradient(colors: l.colors.map(Appearance.color) + [Appearance.color(l.colors[0])], center: .center)))
            .frame(width: 28, height: 28)
            .overlay { Circle().strokeBorder(Color.primary.opacity(0.12)) }
    }
}

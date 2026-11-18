import SwiftUI

/// The looks' colors and the accents, for the watch (always dark). The phone's full version, with light shades and
/// names, is `Look` and `Tint` in iOS/Looks.swift; both come from `src/lib/looks.ts` and `src/soft.css`.
nonisolated enum Palette {
    static let looks: [String: [UInt32]] = [
        "dusk": [0x6E56CF, 0xD6409F, 0x3E63DD],
        "tide": [0x0090FF, 0x12A594, 0x6E56CF],
        "moss": [0x30A46C, 0x8DB654, 0x12A594],
        "ember": [0xF76B15, 0xE54666, 0xFFB224],
        "bloom": [0xD6409F, 0x8E4EC6, 0xF76B15],
        "aurora": [0x30A46C, 0x6E56CF, 0x0090FF],
    ]
    /// Each look's own accent, and the fixed accents, in their dark-mode shades.
    static let lookAccents: [String: UInt32] = [
        "dusk": 0x9B7BFF, "tide": 0x4C9DFF, "moss": 0x4CC38A, "ember": 0xFF8A3D, "bloom": 0xFF6BB5, "aurora": 0x5FD4A0,
    ]
    static let tints: [String: UInt32] = [
        "blue": 0x4C8DFF, "violet": 0x9B7BFF, "teal": 0x2EC4B6, "green": 0x4CC38A, "amber": 0xF5A524, "rose": 0xFF6B8B,
    ]

    static func color(_ v: UInt32) -> Color {
        Color(red: Double(v >> 16 & 0xFF) / 255, green: Double(v >> 8 & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }

    /// The accent for a look and tint; white for Neutral (and Graphite matching itself).
    static func accent(look: String, tint: String) -> Color {
        if let t = tints[tint] { return color(t) }
        if tint == "look", let a = lookAccents[look] { return color(a) }
        return .white
    }

    static func wash(_ look: String) -> [Color] { (looks[look] ?? []).map(color) }
}

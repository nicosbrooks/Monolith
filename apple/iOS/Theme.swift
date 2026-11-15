import SwiftUI
import UIKit

/// Monolith's look on top of native controls: the system font throughout, a soft paper background,
/// monochrome ink. Accents only where they mean something: red = recording, blue = calendar.
enum Theme {
    private static func hex(_ v: UInt32) -> UIColor {
        UIColor(red: CGFloat(v >> 16 & 0xFF) / 255, green: CGFloat(v >> 8 & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
    private static func pair(_ dark: UInt32, _ light: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? hex(dark) : hex(light) })
    }
    /// Page background: warm near-black in dark, warm paper in light. Same tokens as the web app.
    static let paper = pair(0x000000, 0xF4F3F0)
    /// Rows and panels that sit on the page.
    static let panel = pair(0x0E0E0E, 0xFFFFFF)
    /// Raised surfaces (sheets, inputs, the Ask pill).
    static let raised = pair(0x1E1E1E, 0xFFFFFF)
    /// Hairlines, used sparingly.
    static let rule = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.07) : UIColor(white: 0, alpha: 0.08) })
    /// Rounded cards on Home: a soft lift off the page, no border.
    static let card = pair(0x161616, 0xFFFFFF)
    /// Quiet fills behind icons and chips.
    static let wash = pair(0x1A1A1A, 0xECEBE7)
    /// Signals: on-device and private, calendar time, recording.
    static let local = pair(0x7FD69E, 0x2F9E62)
    static let time = pair(0x86B3FF, 0x2F6FDB)
}

extension Font {
    /// Section headings: quiet, one step above body text.
    static let sub = Font.headline
}

extension View {
    /// Section header used across lists.
    func sectionTitle() -> some View {
        font(.sub).foregroundStyle(.primary).textCase(nil)
    }

    /// Small grey label over a group of rows ("Pinned", "This week").
    func groupLabel() -> some View {
        font(.footnote.weight(.medium)).foregroundStyle(.secondary).textCase(nil)
    }

    /// Paper background behind a List or ScrollView.
    func paper() -> some View {
        scrollContentBackground(.hidden)
            .listRowSeparator(.hidden)
            .listSectionSeparator(.hidden)
            .background(Theme.paper.ignoresSafeArea())
    }
}

/// Rounded-square glyph used for item kinds and menu options.
struct Glyph: View {
    var symbol: String
    var size: CGFloat = 32
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.45, weight: .medium))
            .frame(width: size, height: size)
            .background(Theme.wash, in: .rect(cornerRadius: size * 0.3))
    }
}

struct EmptyState: View {
    var symbol: String
    var title: String
    var message: String
    var body: some View {
        ContentUnavailableView {
            Label { Text(title).font(.title3.weight(.semibold)) } icon: { Image(systemName: symbol) }
        } description: {
            Text(message)
        }
    }
}

extension Date {
    var shortRelative: String {
        if Calendar.current.isDateInToday(self) { return formatted(date: .omitted, time: .shortened) }
        if Calendar.current.isDateInYesterday(self) { return "Yesterday" }
        return formatted(.dateTime.month(.defaultDigits).day().year(.twoDigits))
    }
}

/// A row you can tap: on press it settles onto a soft rounded wash, like the web app's hover, then lets go.
struct RowPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            // The wash bleeds a little past the row's edges, so the text doesn't sit against it.
            .background { RoundedRectangle(cornerRadius: 10).fill(Theme.wash).padding(.horizontal, -8).opacity(configuration.isPressed ? 1 : 0) }
            .animation(.easeOut(duration: configuration.isPressed ? 0.06 : 0.25), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == RowPressStyle {
    static var row: RowPressStyle { .init() }
}

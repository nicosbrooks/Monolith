import SwiftUI

/// A doc or recording as a card, like the web's Docs page and Home's Recent row: an icon tile, the title, the first
/// lines, and when. Used in the Docs grid and Home's Recent.
struct DocCard: View {
    var item: Item
    var lines = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                tile
                Spacer(minLength: 4)
                Text(meta).font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(item.displayTitle).font(.body.weight(.semibold)).lineLimit(1)
                    .multilineTextAlignment(.leading)
                Text(preview).font(.footnote).foregroundStyle(.secondary)
                    .lineLimit(lines, reservesSpace: true)
                    .multilineTextAlignment(.leading)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel(radius: 20)
        .contentShape(.rect(cornerRadius: 20))
    }

    private var tile: some View {
        Group {
            if let e = item.displayEmoji { Text(e).font(.system(size: 16)) }
            else if item.kind == .lecture { Image(systemName: "waveform").font(.system(size: 13, weight: .semibold)).foregroundStyle(.red) }
            else { Image(systemName: "doc.text").font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary) }
        }
        .frame(width: 30, height: 30)
        .background(Theme.tile, in: .rect(cornerRadius: 9, style: .continuous))
    }

    private var meta: String {
        item.kind == .lecture && item.duration > 0 ? item.duration.clock : item.updatedAt.shortRelative
    }

    private var preview: String {
        let p = item.previewLines(lines + 1).trimmingCharacters(in: .whitespacesAndNewlines)
        if !p.isEmpty { return p }
        return item.kind == .lecture ? "No transcript yet" : "Empty"
    }
}

/// Presses settle a card down a little and let go with a spring.
struct CardPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == CardPressStyle {
    static var card: CardPressStyle { .init() }
}

/// A panel with a name and one link in its header (Home's Tasks and Calendar, a group of tasks).
struct Panel<Content: View, Trailing: View>: View {
    var title: String
    var tone: Color = .primary
    @ViewBuilder var link: Trailing
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(tone)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                link.font(.subheadline).foregroundStyle(.secondary)
            }
            .padding(.bottom, 4)
            content
        }
        .padding(.horizontal, Space.card).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}

extension Panel where Trailing == EmptyView {
    init(title: String, tone: Color = .primary, @ViewBuilder content: () -> Content) {
        self.init(title: title, tone: tone, link: { EmptyView() }, content: content)
    }
}

/// Monolith's mark: the upright slab, 4 wide to 9 tall. Always the text color.
struct Slab: View {
    var height: CGFloat = 36
    var body: some View {
        RoundedRectangle(cornerRadius: height * 0.12, style: .continuous)
            .fill(Color.primary)
            .frame(width: height * 4 / 9, height: height)
            .accessibilityHidden(true)
    }
}

/// An empty place that says what goes here and offers the one thing to do about it.
struct WarmEmpty: View {
    var title: String
    var message: String
    var action: String? = nil
    var run: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 14) {
            Slab(height: 30).opacity(0.85)
            VStack(spacing: 6) {
                Text(title).font(.title3.weight(.semibold))
                Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            if let action, let run {
                Button(action: run) {
                    Text(action).font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 20).frame(height: 42)
                }
                .buttonStyle(.glassProminent)
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: 320)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }
}

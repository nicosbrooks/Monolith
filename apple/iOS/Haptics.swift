import UIKit

/// Taps you can feel, matched to what happened. Light and rare: a tap for a choice, a thud for something
/// destructive, a ripple when something worked. Off when the person turns off System Haptics.
@MainActor
enum Haptics {
    private static let soft = UIImpactFeedbackGenerator(style: .soft)
    private static let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private static let pick = UISelectionFeedbackGenerator()
    private static let note = UINotificationFeedbackGenerator()

    /// A choice moved: a toggle, a star, a swipe crossing its line.
    static func tap() { pick.selectionChanged() }
    /// A press that opens more (a long hold).
    static func hold() { soft.impactOccurred(intensity: 0.8) }
    /// Something removed or completed for good.
    static func thud() { rigid.impactOccurred(intensity: 0.7) }
    static func success() { note.notificationOccurred(.success) }
    static func warning() { note.notificationOccurred(.warning) }
    static func error() { note.notificationOccurred(.error) }
}

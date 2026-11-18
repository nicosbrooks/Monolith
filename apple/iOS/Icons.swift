import SwiftUI

/// The few icons that are Monolith's own on the web (src/components/icons.tsx): Listen, the ⋯ menu and the Vault.
/// Same drawings here, as template images, so every device shows the same marks. Everything else is an SF Symbol.
enum Icon {
    static var more: Image { Image("mono.more") }
    static var listen: Image { Image("mono.listen") }
    static var vault: Image { Image("mono.vault") }
}

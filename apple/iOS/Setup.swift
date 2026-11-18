import SwiftUI
import LocalAuthentication

// MARK: - Profile

/// What first-time setup asks for. Stored in UserDefaults so every screen can read it with @AppStorage.
enum Profile {
    static let name = "userName"
    static let setupAt = "setupAt"     // seconds since 1970; 0 = setup not done yet
    static let lock = "appLock"

    /// Installs from before setup existed already have work in them: don't ask them to set up again.
    /// Call before anything is seeded, so an empty database still means a new install.
    static func markExistingInstall(hasItems: Bool) {
        let d = UserDefaults.standard
        if d.object(forKey: setupAt) == nil, hasItems { d.set(1.0, forKey: setupAt) } // "long ago"
    }
}

// MARK: - Greeting (mirrors src/lib/greeting.ts; keep the phrases in step)

enum Greeting {
    private enum Part: Int { case night, morning, afternoon, evening }
    private static func part(_ d: Date) -> Part {
        let h = Calendar.current.component(.hour, from: d)
        return h < 5 ? .night : h < 12 ? .morning : h < 18 ? .afternoon : .evening
    }
    private static let phrases: [Part: [String]] = [
        .night: ["Late night", "Still going", "Good evening"],
        .morning: ["Good morning", "Morning", "Fresh start"],
        .afternoon: ["Good afternoon", "Afternoon", "Hope the day’s going well"],
        .evening: ["Good evening", "Evening", "Winding down"],
    ]

    /// Fixed for a given day and part of day, so it doesn't change while you use the app.
    static func text(_ now: Date = .now, name: String, away: TimeInterval = 0) -> String {
        let first = name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
        let p = part(now)
        let phrase: String
        if away > 2 * 86_400 { phrase = "Welcome back" } else {
            var options = phrases[p] ?? ["Hello"]
            let dow = Calendar.current.component(.weekday, from: now) // 1 = Sunday
            if dow == 6, p != .night { options.append("Happy Friday") }
            if dow == 1 || dow == 7, p != .night { options.append(dow == 1 ? "Happy Sunday" : "Happy Saturday") }
            let day = Int((now.timeIntervalSince1970 + Double(TimeZone.current.secondsFromGMT(for: now))) / 86_400)
            phrase = options[(day * 7 + p.rawValue) % options.count]
        }
        return first.isEmpty ? phrase : "\(phrase), \(first)"
    }

    /// The assistant card's title: an invitation on the first day, then what the starting points are about.
    static func startersTitle(_ now: Date = .now, setupAt: Double, soon: Bool, onlyDocs: Bool) -> String {
        if setupAt > 1, now.timeIntervalSince1970 - setupAt < 86_400 { return "Start from here" }
        if soon { return "Coming up" }
        if onlyDocs { return "Pick up where you left off" }
        switch part(now) {
        case .morning: return "For this morning"
        case .afternoon: return "For this afternoon"
        default: return "For tonight"
        }
    }

    /// Time since Home was last shown on this device (0 the first time).
    static func away() -> TimeInterval {
        let d = UserDefaults.standard
        let last = d.double(forKey: "lastHome")
        d.set(Date.now.timeIntervalSince1970, forKey: "lastHome")
        return last > 0 ? Date.now.timeIntervalSince1970 - last : 0
    }
}

// MARK: - App lock

/// Face ID (or Touch ID, or the device passcode) before Monolith shows anything. iOS already encrypts the app's
/// files with the device passcode; the lock adds a check each time Monolith is opened, and hides it in the app switcher.
@Observable final class AppLock {
    static let shared = AppLock()
    var locked: Bool
    private(set) var enabled: Bool

    private init() {
        let on = UserDefaults.standard.bool(forKey: Profile.lock)
        enabled = on
        locked = on
    }

    /// "Face ID", "Touch ID", "Optic ID", or "Passcode" when there's no biometrics. Nil: the device has no passcode.
    static var method: String? {
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { return nil }
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "Passcode"
        }
    }
    static var symbol: String {
        switch method {
        case "Face ID": "faceid"
        case "Touch ID": "touchid"
        case "Optic ID": "opticid"
        default: "lock"
        }
    }

    @discardableResult func authenticate(_ reason: String = "Unlock Monolith") async -> Bool {
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { return false }
        return (try? await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) == true
    }

    /// Turning it on asks once, so a lock that can't be opened is never saved.
    func setEnabled(_ on: Bool) async -> Bool {
        if on, !(await authenticate("Turn on the lock for Monolith")) { return false }
        UserDefaults.standard.set(on, forKey: Profile.lock)
        enabled = on
        locked = false
        return true
    }

    func unlock() async { if await authenticate() { locked = false } }
    func lockIfEnabled() { if enabled { locked = true } }
}

/// Covers the app while it's locked, and asks right away. While Monolith is only in the background
/// (the app switcher, Control Center) it's a plain cover with nothing to read.
struct LockScreen: View {
    @State private var lock = AppLock.shared
    @Environment(\.scenePhase) private var phase
    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: AppLock.symbol).font(.system(size: 34, weight: .regular)).foregroundStyle(.secondary)
                .frame(width: 72, height: 72).background(Theme.tile, in: .circle)
            VStack(spacing: 6) {
                Text("Monolith is locked").font(.title3.weight(.semibold))
                Text("Your work opens after \(AppLock.method ?? "you unlock").").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            Button { Task { await lock.unlock() } } label: {
                Text("Unlock").font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.glassProminent).tint(.primary).foregroundStyle(Color(uiColor: .systemBackground))
            .padding(.horizontal, Space.page).padding(.bottom, 24)
            .opacity(lock.locked ? 1 : 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.paper.ignoresSafeArea())
        // Ask as soon as Monolith is in front, not while it's still in the background.
        .task { if lock.locked && phase == .active { await lock.unlock() } }
        .onChange(of: phase) { if phase == .active && lock.locked { Task { await lock.unlock() } } }
    }
}

// MARK: - First-time setup

/// Two short steps: a name for greetings, then where work is kept and whether it's locked.
struct SetupView: View {
    @AppStorage(Profile.name) private var savedName = ""
    @AppStorage(Profile.setupAt) private var setupAt = 0.0
    @State private var step = 0
    @State private var name = ""
    @State private var lockOn = AppLock.shared.enabled
    @State private var asking = false
    @State private var failed = false
    @FocusState private var nameFocused: Bool
    private let method = AppLock.method

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                if step > 0 {
                    Button { withAnimation(.snappy) { step = 0 } } label: {
                        Image(systemName: "chevron.left").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                    }
                    .glassEffect(.regular, in: .circle).accessibilityLabel("Back")
                }
                Spacer()
                HStack(spacing: 6) {
                    ForEach(0..<2) { i in
                        Capsule().fill(i == step ? Color.primary : Theme.tile).frame(width: i == step ? 28 : 18, height: 4)
                    }
                }
                .accessibilityElement().accessibilityLabel("Step \(step + 1) of 2")
                Spacer()
                Color.clear.frame(width: 44, height: 44)
            }
            .padding(.bottom, 28)

            Group {
                if step == 0 { nameStep.transition(.move(edge: .leading).combined(with: .opacity)) }
                else { storageStep.transition(.move(edge: .trailing).combined(with: .opacity)) }
            }
            .frame(maxHeight: .infinity, alignment: .top)

            Button(action: next) {
                Text(step == 0 ? "Continue" : "Start using Monolith")
                    .font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.glassProminent).tint(.primary).foregroundStyle(Color(uiColor: .systemBackground))
            .disabled(asking)
        }
        .padding(.horizontal, Space.page).padding(.top, 12).padding(.bottom, 16)
        .background(Theme.paper.ignoresSafeArea())
        .onAppear { name = savedName; nameFocused = true }
    }

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Welcome to Monolith").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            Text("Notes, docs, recordings and your calendar in one place, with an assistant that runs on this \(Linker.deviceName).")
                .font(.body).foregroundStyle(.secondary).padding(.bottom, 22)
            Text("What should we call you?").font(.headline)
            TextField("Your first name", text: $name)
                .textContentType(.givenName).textInputAutocapitalization(.words).submitLabel(.continue)
                .focused($nameFocused).onSubmit(next)
                .font(.title3)
                .padding(.horizontal, 16).frame(minHeight: 54)
                .background(Theme.card, in: .rect(cornerRadius: 16, style: .continuous))
            Text("Used in greetings. Leave it blank if you’d rather not.").font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var storageStep: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Where your work lives").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            Text("Everything stays on this \(Linker.deviceName). Link a computer later in Settings to work on both.")
                .font(.body).foregroundStyle(.secondary).padding(.bottom, 22)

            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    Image(systemName: "iphone").font(.title3).foregroundStyle(.secondary).frame(width: 28)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("On this \(Linker.deviceName)").font(.body.weight(.semibold))
                        Text("Encrypted by iOS with your device passcode.").font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(.primary)
                }
                .padding(16)
                .accessibilityElement(children: .combine).accessibilityAddTraits(.isSelected)

                HStack(spacing: 14) {
                    Image(systemName: AppLock.symbol).font(.title3).foregroundStyle(.secondary).frame(width: 28)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Lock with \(method ?? "Face ID")").font(.body.weight(.semibold))
                        Text(method == nil ? "Set a passcode for this \(Linker.deviceName) in Settings to use this." : "Asked each time you open Monolith. Hidden in the app switcher.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Toggle("Lock with \(method ?? "Face ID")", isOn: Binding(get: { lockOn }, set: { want in
                        asking = true
                        failed = false
                        Task {
                            if await AppLock.shared.setEnabled(want) { lockOn = want } else { failed = true }
                            asking = false
                        }
                    }))
                    .labelsHidden().tint(Theme.local).disabled(method == nil || asking)
                }
                .padding(16)
            }
            .background(Theme.card, in: .rect(cornerRadius: 22, style: .continuous))
            if failed {
                Text("\(method ?? "Face ID") didn’t go through, so the lock is still off. Try again.")
                    .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 4)
            }
        }
    }

    private func next() {
        if step == 0 { withAnimation(.snappy) { step = 1 }; nameFocused = false; return }
        savedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        setupAt = Date.now.timeIntervalSince1970
    }
}

/// Settings: the name used in greetings and the lock, the two things setup asked for.
struct YouSection: View {
    @AppStorage(Profile.name) private var name = ""
    @State private var lockOn = AppLock.shared.enabled
    @State private var asking = false
    private let method = AppLock.method

    var body: some View {
        Section {
            TextField("Your first name", text: $name).textContentType(.givenName).textInputAutocapitalization(.words)
            Toggle(isOn: Binding(get: { lockOn }, set: { want in
                asking = true
                Task {
                    if await AppLock.shared.setEnabled(want) { lockOn = want }
                    asking = false
                }
            })) { Label("Lock with \(method ?? "Face ID")", systemImage: AppLock.symbol) }
                .tint(Theme.local).disabled(method == nil || asking)
        } header: {
            Text("You").sectionTitle()
        } footer: {
            Text(method == nil ? "Set a passcode for this \(Linker.deviceName) to use the lock." : "Your name is used in greetings. With the lock on, Monolith asks for \(method!) each time you open it.")
        }
    }
}

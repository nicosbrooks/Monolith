import Foundation
import CryptoKit

// What every sealed message carries besides its content, so the relay can't misuse frames it can't read.
// Same rules as src/link/envelope.ts (checked by scripts/test-link.ts):
//
//   f  the sending device's id (random, chosen once per install)
//   q  a number that only goes up for that device (microseconds since 1970, or one more than the last)
//   _  padding, so a frame's size says little about what's in it
//
// A frame with our own id (the relay bounced it back) or a q already seen from that sender (the relay replayed it) is
// turned away. Devices from before this send neither field; their frames are taken until that room has once sent
// stamped ones, after which unstamped frames are refused too.

nonisolated enum Envelope {
    enum Verdict { case ok, own, replay, unstamped }

    /// The next q after `last`: the clock in microseconds, or one more if the clock went backwards.
    static func next(after last: Double, now: Date = .now) -> Double { max(last + 1, (now.timeIntervalSince1970 * 1_000_000).rounded()) }

    /// Whether to take a frame. `seen` holds the highest q taken from each sender, and is updated when it's `.ok`.
    static func admit(_ seen: inout [String: Double], me: String, f: String?, q: Double?, strict: Bool) -> Verdict {
        guard let f, let q, q.isFinite else { return strict ? .unstamped : .ok }
        if f == me { return .own }
        if q <= (seen[f] ?? 0) { return .replay }
        seen[f] = q
        return .ok
    }

    /// Small frames grow to the next 512 bytes; big ones (records, files) are left as they are.
    static func padding(for size: Int) -> String? {
        guard size < 64 * 1024 else { return nil }
        let block = 512
        let fill = ((size + 7 + block - 1) / block) * block - size - 7
        return String(repeating: ".", count: max(0, fill))
    }
}

// MARK: - Files

/// Files that arrive from linked computers (pictures and attachments in docs), kept once per content under the same
/// short hash the web uses: the first 16 bytes of SHA-256, in hex. The phone keeps every file it's given, so a second
/// computer can get it from here.
nonisolated enum FileStore {
    struct Meta: Codable { var name: String; var type: String; var size: Int }

    static let arrived = Notification.Name("monolith.file.arrived")
    static let limit = 250 * 1024 * 1024

    private static var dir: URL {
        let d = URL.applicationSupportDirectory.appending(path: "files", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    static func isHash(_ h: String) -> Bool { h.count == 32 && h.allSatisfy { $0.isHexDigit && ($0.isNumber || $0.isLowercase) } }

    static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    static func meta(_ h: String) -> Meta? {
        guard isHash(h), let d = try? Data(contentsOf: dir.appending(path: "\(h).json")) else { return nil }
        return try? JSONDecoder().decode(Meta.self, from: d)
    }

    /// Where the file is, under its own name, so other apps (Share, Files) see a proper file.
    static func url(_ h: String) -> URL? {
        guard let m = meta(h) else { return nil }
        let u = dir.appending(path: h, directoryHint: .isDirectory).appending(path: safe(m.name))
        return FileManager.default.fileExists(atPath: u.path()) ? u : nil
    }

    static func data(_ h: String) -> Data? { url(h).flatMap { try? Data(contentsOf: $0) } }

    /// Keep a file, if it is the one its hash names. Returns false when it isn't.
    @discardableResult
    static func put(_ data: Data, hash h: String, name: String, type: String) -> Bool {
        guard isHash(h), data.count <= limit, hash(data) == h else { return false }
        if meta(h) != nil { return true }
        let folder = dir.appending(path: h, directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: folder.appending(path: safe(name)), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            let m = Meta(name: String(name.prefix(200)), type: String(type.prefix(100)), size: data.count)
            try JSONEncoder().encode(m).write(to: dir.appending(path: "\(h).json"), options: .atomic)
        } catch { return false }
        NotificationCenter.default.post(name: arrived, object: h)
        return true
    }

    /// Every file a Markdown body refers to.
    static func refs(in body: String) -> [String] {
        guard body.contains("monolith-file:") else { return [] }
        let re = /monolith-file:([0-9a-f]{32})/
        return body.matches(of: re).map { String($0.1) }
    }

    private static func safe(_ name: String) -> String {
        let n = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespaces)
        return n.isEmpty || n.hasPrefix(".") ? "file" : String(n.prefix(120))
    }
}

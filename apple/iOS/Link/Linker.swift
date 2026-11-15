import Foundation
import SwiftData
import CryptoKit
import UIKit
import os

private let log = Logger(subsystem: "com.socratic.app", category: "link")

/// A computer linked to this phone.
struct Pairing: Codable, Identifiable, Hashable {
    var room: String
    var key: String // b64url raw AES key
    var name: String
    var relay: String // ws(s)://host the computer chose; both sides connect out to it
    var linkedAt: Date
    var id: String { room }
}

/// What a pairing QR code (monolith://pair?…, or socratic:// from before the rename) asks for.
struct PairRequest: Identifiable, Hashable {
    let room: String, webPub: Data, secret: Data, relay: String, name: String
    var id: String { room }

    init?(url: URL) {
        guard url.scheme == "monolith" || url.scheme == "socratic", url.host() == "pair",
              let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        func v(_ k: String) -> String? { q.first { $0.name == k }?.value }
        guard let room = v("r"), room.range(of: "^[A-Za-z0-9_-]{16,64}$", options: .regularExpression) != nil,
              let pub = v("k").flatMap(B64U.decode), pub.count == 65,
              let secret = v("s").flatMap(B64U.decode), secret.count >= 16,
              let relay = v("u"), let r = URL(string: relay), ["ws", "wss", "http", "https"].contains(r.scheme ?? "")
        else { return nil }
        self.room = room
        self.webPub = pub
        self.secret = secret
        self.relay = relay.replacingOccurrences(of: "^http", with: "ws", options: .regularExpression)
        self.name = String((v("n") ?? "Computer").replacingOccurrences(of: "+", with: " ").prefix(60))
    }
}

/// One note, doc, lecture or event as it travels between devices. Same shape as `Rec` in src/link/link.ts.
struct Rec: Codable {
    struct Line: Codable { var start: Double; var text: String }
    var id: String
    var kind: String
    var updatedAt: Double
    var deletedAt: Double?
    var title: String?
    var body: String?
    var emoji: String?
    var pinned: Bool?
    var folder: String?
    var parentId: String?
    var duration: Double?
    var transcript: [Line]?
    var start: Double?
    var end: Double?
    var allDay: Bool?
    var location: String?
    var color: String?
}

private struct Msg: Codable {
    var t: String // hi · snap · put · bye
    var n: String?
    var recs: [Rec]?
}

nonisolated extension Date {
    var ms: Double { (timeIntervalSince1970 * 1000).rounded() }
    init(ms: Double) { self.init(timeIntervalSince1970: ms / 1000) }
}

extension Item { var recID: String { syncID ?? id.uuidString.lowercased() } }
extension Event { var recID: String { syncID ?? id.uuidString.lowercased() } }

/// Keeps linked computers in sync. The phone is the hub: it holds the library, and each computer that scanned a
/// QR code gets an end-to-end encrypted channel through a relay both connect out to, so no shared network is needed.
/// Conflicts: newest edit wins.
@Observable
final class Linker {
    static let shared = Linker()

    enum PairState: Equatable { case confirm, linking, linked, failed(String) }

    private(set) var pairings: [Pairing] = []
    /// Other devices currently in each pairing's room.
    private(set) var online: [String: Int] = [:]
    private(set) var lastSync: Date?
    /// A scanned code waiting for the person to say yes, and how that's going.
    var request: PairRequest? { didSet { log.debug("request \(self.request?.room ?? "nil", privacy: .public)") } }
    var pairState: PairState = .confirm

    var anyOnline: Bool { online.values.contains { $0 > 0 } }

    private final class Conn {
        let task: URLSessionWebSocketTask
        let key: SymmetricKey
        var retry = 0
        /// The relay has answered, so the socket is really open.
        var open = false
        init(task: URLSessionWebSocketTask, key: SymmetricKey) { self.task = task; self.key = key }
    }

    private var conns: [String: Conn] = [:]
    private var ctx: ModelContext?
    private var timer: Timer?
    private var ticks = 0

    /// What this phone remembers between launches so that edits and deletions made while no computer was
    /// connected still reach it later.
    private struct Memory: Codable {
        struct Tomb: Codable { var kind: String; var at: Double }
        /// A short hash of each record as last sent or received, so only real changes go out.
        var sigs: [String: String] = [:]
        var kinds: [String: String] = [:]
        /// Events have no edit time of their own, so we note when we saw each one change (ms).
        var eventTimes: [String: Double] = [:]
        /// Records deleted for good here, and when. Without these a computer would hand them straight back.
        var tombs: [String: Tomb] = [:]
    }
    private var memory = Memory()
    /// Cheap per-item fingerprint, so the full record is only built when something moved.
    private var glance: [String: String] = [:]

    static var deviceName: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone" }

    // MARK: Start

    func start(context: ModelContext) {
        guard ctx == nil else { return }
        ctx = context
        if let d = LinkKeychain.load(), let ps = try? JSONDecoder().decode([Pairing].self, from: d) { pairings = ps }
        loadMemory()
        scan()
        pairings.forEach(connect)
        // Look for local edits every couple of seconds. Cheap: a few hundred records, and most are skipped at a glance.
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    private func tick() {
        ticks += 1
        scan()
        // Relays and mobile networks drop sockets that stay quiet, and a dead one can look open for minutes.
        if ticks % 12 == 0 { ping() }
    }

    /// Call when the app comes back to the foreground: sockets don't survive suspension.
    func resume() {
        for p in pairings where conns[p.room].map({ $0.task.state != .running }) ?? true { connect(p) }
        ping()
    }

    private func ping() {
        for (room, c) in conns where c.open && c.task.state == .running {
            let task = c.task
            task.sendPing { [weak self] error in
                guard error != nil else { return }
                Task { @MainActor [weak self] in self?.dropped(room, task) }
            }
        }
    }

    // MARK: Connections

    private func connect(_ p: Pairing) {
        guard let raw = B64U.decode(p.key), let url = URL(string: "\(p.relay)/relay?room=\(p.room)") else { return }
        let task = URLSession.shared.webSocketTask(with: url)
        let retry = conns[p.room]?.retry ?? 0
        conns[p.room]?.task.cancel(with: .goingAway, reason: nil)
        let c = Conn(task: task, key: SymmetricKey(data: raw))
        c.retry = retry
        conns[p.room] = c
        task.resume()
        receive(p.room, task)
    }

    private func receive(_ room: String, _ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self, self.conns[room]?.task === task else { return }
                switch result {
                case .success(let m):
                    self.conns[room]?.retry = 0
                    self.conns[room]?.open = true
                    if case .string(let s) = m { self.got(room, s) }
                    self.receive(room, task)
                case .failure(let e):
                    log.debug("socket dropped \(e.localizedDescription, privacy: .public)")
                    self.dropped(room, task)
                }
            }
        }
    }

    private func dropped(_ room: String, _ task: URLSessionWebSocketTask) {
        online[room] = 0
        guard let c = conns[room], c.task === task, let p = pairings.first(where: { $0.room == room }) else { return }
        c.retry += 1
        let wait = min(30, pow(2, Double(c.retry)))
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(wait))
            if self.conns[room]?.task === task { self.connect(p) }
        }
    }

    private func got(_ room: String, _ text: String) {
        log.debug("got \(text.prefix(80), privacy: .public)")
        guard let data = text.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if obj["relay"] as? String == "peers", let n = obj["n"] as? Int {
            online[room] = max(0, n - 1)
            if n > 1 { send(room, "snap", snapshot()) }
            return
        }
        guard let box = obj["c"] as? String, let key = conns[room]?.key,
              let plain = try? LinkCrypto.open(box, key: key),
              let msg = try? JSONDecoder().decode(Msg.self, from: plain) else { return } // not for us, or tampered with
        switch msg.t {
        case "hi":
            if let n = msg.n { rename(room, n) }
            if request?.room == room { pairState = .linked }
            send(room, "snap", snapshot())
        case "snap", "put": apply(msg.recs ?? [])
        case "bye": remove(room)
        default: break
        }
    }

    private func send(_ room: String, _ msg: Msg) {
        guard let c = conns[room], let plain = try? JSONEncoder().encode(msg), let box = try? LinkCrypto.seal(plain, key: c.key),
              let frame = try? JSONSerialization.data(withJSONObject: ["c": box]) else { return }
        c.task.send(.string(String(decoding: frame, as: UTF8.self))) { _ in }
    }

    /// Sends records in batches small enough for the relay, which refuses very large messages.
    private func send(_ room: String, _ t: String, _ recs: [Rec]) {
        var batch: [Rec] = []
        var size = 0
        for r in recs {
            let n = (r.body?.utf8.count ?? 0) + (r.title?.utf8.count ?? 0) + (r.transcript ?? []).reduce(0) { $0 + $1.text.utf8.count + 24 } + 200
            if n > 5_000_000 { log.error("too big to sync: \(r.id, privacy: .public)"); continue }
            if size + n > 1_000_000, !batch.isEmpty {
                send(room, Msg(t: t, recs: batch))
                batch = []
                size = 0
            }
            batch.append(r)
            size += n
        }
        if !batch.isEmpty { send(room, Msg(t: t, recs: batch)) }
    }

    private func broadcast(_ recs: [Rec]) { for p in pairings where (online[p.room] ?? 0) > 0 { send(p.room, "put", recs) } }

    // MARK: Pairing

    /// Answer a scanned code. Succeeds once the computer says hi back.
    func pair(_ r: PairRequest) {
        pairState = .linking
        log.debug("pairing \(r.relay, privacy: .public)")
        do {
            let (hello, raw) = try LinkCrypto.answer(webPub: r.webPub, secret: r.secret, name: Self.deviceName)
            let p = Pairing(room: r.room, key: B64U.encode(raw), name: r.name, relay: r.relay, linkedAt: .now)
            pairings.removeAll { $0.room == p.room }
            pairings.append(p)
            save()
            scan()
            connect(p)
            let frame = try JSONSerialization.data(withJSONObject: hello)
            conns[p.room]?.task.send(.string(String(decoding: frame, as: UTF8.self))) { [weak self] error in
                guard error != nil else { return }
                Task { @MainActor [weak self] in self?.failPairing(r.room, "Couldn’t reach the sync relay. Check your connection and try again.") }
            }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(15))
                if self.request?.room == r.room, self.pairState == .linking {
                    self.failPairing(r.room, "The computer didn’t answer. Make sure the code is still showing, then scan it again.")
                }
            }
        } catch {
            pairState = .failed("That code didn’t work. Show a new one on your computer and scan again.")
        }
    }

    private func failPairing(_ room: String, _ message: String) {
        guard pairState != .linked else { return }
        pairState = .failed(message)
        remove(room)
    }

    func unlink(_ p: Pairing) {
        send(p.room, Msg(t: "bye"))
        remove(p.room)
    }

    private func remove(_ room: String) {
        conns.removeValue(forKey: room)?.task.cancel(with: .goingAway, reason: nil)
        online[room] = nil
        pairings.removeAll { $0.room == room }
        save()
        // Nothing linked: nothing to remember for.
        if pairings.isEmpty { memory = Memory(); glance = [:]; saveMemory() }
    }

    private func rename(_ room: String, _ name: String) {
        guard let i = pairings.firstIndex(where: { $0.room == room }), pairings[i].name != name else { return }
        pairings[i].name = String(name.prefix(60))
        save()
    }

    private func save() {
        if let d = try? JSONEncoder().encode(pairings) { LinkKeychain.save(d) }
    }

    // MARK: Records

    private func rec(_ i: Item) -> Rec {
        let lecture = i.kind == .lecture
        // Older notes separate lines with a single line break, which the web editor would run together.
        return Rec(id: i.recID, kind: i.kindRaw, updatedAt: i.updatedAt.ms, deletedAt: i.deletedAt?.ms, title: i.title, body: lecture ? i.body : Block.tidy(i.body),
                   emoji: i.emoji, pinned: i.pinned, folder: i.folder, parentId: i.parent?.recID,
                   duration: lecture ? i.duration : nil, transcript: lecture ? i.transcript.map { .init(start: $0.start, text: $0.text) } : nil)
    }

    private func rec(_ e: Event) -> Rec {
        Rec(id: e.recID, kind: "event", updatedAt: memory.eventTimes[e.recID] ?? 0, title: e.title, start: e.start.ms, end: e.end.ms,
            allDay: e.allDay, location: e.location, color: e.color)
    }

    /// A record that only says "this was deleted for good".
    private func gone(_ id: String, _ t: Memory.Tomb) -> Rec { Rec(id: id, kind: t.kind, updatedAt: t.at, deletedAt: t.at) }

    /// Short hash of a record's content, ignoring its timestamp.
    private func sig(_ r: Rec) -> String {
        var r = r
        r.updatedAt = 0
        let enc = JSONEncoder()
        enc.outputFormatting = .sortedKeys
        guard let d = try? enc.encode(r) else { return "" }
        return B64U.encode(Data(SHA256.hash(data: d).prefix(12)))
    }

    /// Everything that can change without the body changing, plus the edit time that body edits always move.
    private func glance(_ i: Item) -> String {
        "\(i.updatedAt.ms)|\(i.deletedAt?.ms ?? 0)|\(i.pinned)|\(i.folder ?? "")|\(i.emoji ?? "")|\(i.parent?.recID ?? "")|\(i.kindRaw)|\(i.title.count)|\(i.duration)"
    }

    private func snapshot() -> [Rec] {
        guard let ctx, let items = try? ctx.fetch(FetchDescriptor<Item>()), let events = try? ctx.fetch(FetchDescriptor<Event>()) else { return [] }
        return items.map(rec) + events.map(rec) + memory.tombs.map(gone)
    }

    private func forget(_ id: String) {
        memory.sigs[id] = nil
        memory.kinds[id] = nil
        memory.eventTimes[id] = nil
        glance[id] = nil
    }

    /// Looks for local changes: stamps them, notes deletions, and sends them on if a computer is listening.
    /// Runs whether or not anything is connected, so nothing done offline is missed.
    private func scan() {
        // If the library can't be read, do nothing. An empty answer here would look like everything was deleted.
        guard !pairings.isEmpty, let ctx, let items = try? ctx.fetch(FetchDescriptor<Item>()),
              let events = try? ctx.fetch(FetchDescriptor<Event>()) else { return }
        var out: [Rec] = []
        var seen = Set<String>()
        let now = Date.now

        for i in items {
            let id = i.recID
            seen.insert(id)
            let g = glance(i)
            guard glance[id] != g else { continue }
            var r = rec(i)
            let s = sig(r)
            guard memory.sigs[id] != s else { glance[id] = g; continue }
            // Some edits (pin, move to folder) don't stamp the item; make sure they still win on the other side.
            if memory.sigs[id] != nil, now.timeIntervalSince(i.updatedAt) > 5 { i.updatedAt = now; r.updatedAt = now.ms }
            memory.sigs[id] = s
            memory.kinds[id] = i.kindRaw
            memory.tombs[id] = nil
            glance[id] = glance(i)
            out.append(r)
        }
        for e in events {
            let id = e.recID
            seen.insert(id)
            let s = sig(rec(e))
            guard memory.sigs[id] != s else { continue }
            // Seen before with a time but no hash (first run of this version): it hasn't changed, keep its time.
            if memory.sigs[id] != nil || memory.eventTimes[id] == nil { memory.eventTimes[id] = now.ms }
            memory.sigs[id] = s
            memory.kinds[id] = "event"
            memory.tombs[id] = nil
            out.append(rec(e))
        }
        // Deleted for good here: remember it, and tell the computers.
        let missing = memory.kinds.filter { !seen.contains($0.key) }
        for (id, kind) in missing {
            forget(id)
            // People delete one thing at a time. A big batch vanishing is something else (a restore, a reset), and
            // must not be passed on as deletions.
            guard missing.count <= 20 else { continue }
            let t = Memory.Tomb(kind: kind, at: now.ms)
            memory.tombs[id] = t
            out.append(gone(id, t))
        }
        // Tombstones don't need to live forever.
        let old = now.ms - 180 * 86_400_000
        let stale = memory.tombs.filter { $0.value.at < old }.keys
        stale.forEach { memory.tombs[$0] = nil }

        guard !out.isEmpty || !stale.isEmpty else { return }
        saveMemory()
        if !out.isEmpty { broadcast(out) }
    }

    /// Merge records from a computer. Newest edit wins.
    private func apply(_ recs: [Rec]) {
        guard let ctx, !recs.isEmpty, let items = try? ctx.fetch(FetchDescriptor<Item>()),
              let events = try? ctx.fetch(FetchDescriptor<Event>()) else { return }
        var byID: [String: Item] = [:]
        for i in items { byID[i.recID] = i }
        var evByID: [String: Event] = [:]
        for e in events { evByID[e.recID] = e }
        var touched: [(Item, String?)] = []
        var changed = false
        var eventsChanged = false

        for r in recs {
            let stamp = max(r.updatedAt, r.deletedAt ?? 0)
            if let t = memory.tombs[r.id] {
                if t.at >= stamp { continue } // deleted here after that edit
                memory.tombs[r.id] = nil      // edited somewhere else since, so it comes back
            }
            if r.kind == "event" {
                let cur = evByID[r.id]
                if let del = r.deletedAt {
                    if let cur {
                        guard del >= (memory.eventTimes[r.id] ?? 0) else { continue }
                        ctx.delete(cur)
                        evByID[r.id] = nil
                        forget(r.id)
                        changed = true
                        eventsChanged = true
                    }
                    memory.tombs[r.id] = .init(kind: "event", at: del)
                    continue
                }
                if cur != nil, (memory.eventTimes[r.id] ?? 0) >= r.updatedAt { continue }
                guard let s = r.start, let e = r.end else { continue }
                let ev = cur ?? {
                    let n = Event(title: "", start: .now, end: .now)
                    n.syncID = r.id
                    ctx.insert(n)
                    evByID[r.id] = n
                    return n
                }()
                ev.title = r.title ?? ""
                ev.start = Date(ms: s)
                ev.end = Date(ms: e)
                ev.allDay = r.allDay ?? false
                ev.location = r.location
                if let c = r.color { ev.color = c }
                memory.eventTimes[r.id] = r.updatedAt
                memory.sigs[r.id] = sig(rec(ev))
                memory.kinds[r.id] = "event"
                changed = true
                eventsChanged = true
                continue
            }
            guard var kind = ItemKind(rawValue: r.kind) else { continue }
            if kind == .note { kind = .doc }  // notes were merged into docs
            let cur = byID[r.id]
            if r.deletedAt != nil, r.title == nil, r.body == nil {
                // Deleted for good on a computer.
                guard let cur else { memory.tombs[r.id] = .init(kind: r.kind, at: stamp); continue }
                guard cur.updatedAt.ms < stamp else { continue }
                if cur.deletedAt != nil {
                    // Already in Recently Deleted here too: it goes for good.
                    if let audio = cur.audioURL { try? FileManager.default.removeItem(at: audio) }
                    ctx.delete(cur)
                    byID[r.id] = nil
                    forget(r.id)
                    memory.tombs[r.id] = .init(kind: r.kind, at: stamp)
                } else {
                    // Still in use here: move it to Recently Deleted, where it can be recovered.
                    cur.deletedAt = Date(ms: stamp)
                    cur.updatedAt = Date(ms: stamp)
                    touched.append((cur, cur.parent?.recID))
                }
                changed = true
                continue
            }
            if let cur, cur.updatedAt.ms >= stamp { continue }
            let it = cur ?? {
                let n = Item(kind)
                n.syncID = r.id
                n.createdAt = Date(ms: r.updatedAt)
                ctx.insert(n)
                byID[r.id] = n
                return n
            }()
            it.kind = kind
            it.title = r.title ?? ""
            it.body = r.body ?? ""
            it.emoji = r.emoji
            it.pinned = r.pinned ?? false
            it.folder = r.folder
            if kind == .lecture {
                it.duration = r.duration ?? it.duration
                if let t = r.transcript { it.transcript = t.map { Segment(start: $0.start, text: $0.text) } }
            }
            it.deletedAt = r.deletedAt.map { Date(ms: $0) }
            it.updatedAt = Date(ms: stamp)
            touched.append((it, r.parentId))
            changed = true
        }
        for (it, pid) in touched {
            // A doc can't be its own parent, however the records arrive.
            let parent = pid.flatMap { byID[$0] }
            it.parent = parent === it ? nil : parent
            memory.sigs[it.recID] = sig(rec(it))
            memory.kinds[it.recID] = it.kindRaw
            glance[it.recID] = glance(it)
        }
        saveMemory()
        guard changed else { return }
        try? ctx.save()
        lastSync = .now
        if eventsChanged { PhoneLink.shared.sendAgenda() }
    }

    private func loadMemory() {
        let d = UserDefaults.standard
        if let data = d.data(forKey: "link.memory"), let m = try? JSONDecoder().decode(Memory.self, from: data) { memory = m }
        // Before there was a memory, only event times were kept.
        else if let times = d.dictionary(forKey: "link.eventTimes") as? [String: Double] { memory.eventTimes = times }
        if pairings.isEmpty { memory = Memory() }
    }

    private func saveMemory() {
        if let data = try? JSONEncoder().encode(memory) { UserDefaults.standard.set(data, forKey: "link.memory") }
    }
}

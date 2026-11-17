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
    /// v2 codes: once paired, both devices sync in a room worked out from the key, not the one in the code.
    let privateRoom: Bool
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
        let ws = relay.replacingOccurrences(of: "^http", with: "ws", options: .regularExpression)
        // Frames are sealed either way, but an unencrypted connection would show who talks to whom, and when, to
        // anyone on the network. Only a relay on this network (a computer running the dev server) may use one.
        if ws.hasPrefix("ws://") {
            let host = URL(string: ws)?.host() ?? ""
            let local = host == "localhost" || host.hasSuffix(".local") || host.hasPrefix("10.") || host.hasPrefix("192.168.") || host.hasPrefix("127.")
                || (host.hasPrefix("172.") && (16...31).contains(Int(host.split(separator: ".").dropFirst().first ?? "") ?? 0))
                || (host.hasPrefix("100.") && (64...127).contains(Int(host.split(separator: ".").dropFirst().first ?? "") ?? 0))
            guard local else { return nil }
        }
        self.relay = ws
        self.name = String((v("n") ?? "Computer").replacingOccurrences(of: "+", with: " ").prefix(60))
        self.privateRoom = (Int(v("v") ?? "") ?? 1) >= 2
    }
    /// A relay on this network (the dev server on a computer), which needs the Local Network permission.
    var onLocalNetwork: Bool { relay.hasPrefix("ws://") }
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

/// One turn of a conversation a computer asks this phone's model to answer.
struct Turn: Codable { var role: String; var content: String }

/// What devices say to each other, inside the sealed box. Same shape as `Msg` in src/link/link.ts.
///   hi · n name, c what it can do ("files", "model"), m the model it runs
///   snap / put · recs        bye
///   want · hs file hashes    file · h hash, nm name, ty type, sz size, i piece, of pieces, d bytes (b64url)
///   ask · id, msgs, max, temp    tok / done · id, full (the answer so far), err    stop · id
/// Every message also carries f and q (Envelope.swift), and small ones `_` padding.
private struct Msg: Codable {
    var t: String
    var n: String?
    var c: [String]?
    var m: String?
    var recs: [Rec]?
    var hs: [String]?
    var h: String?
    var nm: String?
    var ty: String?
    var sz: Int?
    var i: Int?
    var of: Int?
    var d: String?
    var id: String?
    var msgs: [Turn]?
    var max: Int?
    var temp: Double?
    var full: String?
    var err: String?
    var f: String?
    var q: Double?
    var pad: String?
    /// On a hi: sent because the sender saw this device arrive, and it has already sent its snapshot.
    var p: Int?

    enum CodingKeys: String, CodingKey { case t, n, c, m, p, recs, hs, h, nm, ty, sz, i, of, d, id, msgs, max, temp, full, err, f, q, pad = "_" }
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
    /// The room the pairing being made will sync in, and the six digits both screens show once it's made.
    private var pendingRoom: String?
    private(set) var pendingCheck: String?

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

    /// This phone's id in every frame it sends (Envelope.swift), and the last q it used.
    private let me: String = {
        if let id = UserDefaults.standard.string(forKey: "link.deviceID") { return id }
        var bytes = [UInt8](repeating: 0, count: 12)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let id = B64U.encode(Data(bytes))
        UserDefaults.standard.set(id, forKey: "link.deviceID")
        return id
    }()
    private var seq: Double = 0
    /// Per room: the highest q taken from each sender, and whether that room's devices stamp their frames.
    private struct Seen: Codable { var from: [String: Double] = [:]; var strict = false }
    private var seen: [String: Seen] = [:]
    private var seenDirty = false
    /// What the computer in each room said it can do.
    private var caps: [String: [String]] = [:]
    /// Files arriving in pieces, and files already asked for (so they aren't asked for twice at once).
    private var incoming: [String: (parts: [Int: Data], of: Int, name: String, type: String, size: Int, at: Date)] = [:]
    private var asked: [String: Date] = [:]
    /// Questions a computer asked this phone's model, still being answered.
    private var answering: [String: Task<Void, Never>] = [:]

    /// Settings › Linked computers › Let computers use this phone's model. On unless turned off.
    static var sharesModel: Bool { UserDefaults.standard.object(forKey: "shareModel") as? Bool ?? true }
    /// What this phone can do for a computer, sent in every hi.
    private var hello: Msg {
        var c = ["files"]
        let model = Self.sharesModel && Assistant.isAvailable
        if model { c.append("model") }
        // Trained on Monolith's action lines (training/): the computer leaves its format guide out of the prompt.
        if model, Assistant.openModel(for: Assistant.choice)?.tuned == true { c.append("tuned") }
        return Msg(t: "hi", n: Self.deviceName, c: c, m: model ? Assistant.modelName : nil)
    }
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
        if let d = UserDefaults.standard.data(forKey: "link.seen"), let s = try? JSONDecoder().decode([String: Seen].self, from: d) { seen = s }
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
        if seenDirty, let d = try? JSONEncoder().encode(seen) { UserDefaults.standard.set(d, forKey: "link.seen"); seenDirty = false }
        // Pieces of files that stopped coming are dropped.
        incoming = incoming.filter { Date.now.timeIntervalSince($0.value.at) < 120 }
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
            if n > 1 {
                send(room, hello)
                send(room, "snap", snapshot())
            }
            return
        }
        guard let box = obj["c"] as? String, let key = conns[room]?.key,
              let plain = try? LinkCrypto.open(box, key: key),
              let msg = try? JSONDecoder().decode(Msg.self, from: plain) else { return } // not for us, or tampered with
        var s = seen[room] ?? Seen()
        guard Envelope.admit(&s.from, me: me, f: msg.f, q: msg.q, strict: s.strict) == .ok else { return }
        if msg.f != nil { s.strict = true; seenDirty = true }
        seen[room] = s
        switch msg.t {
        case "hi":
            if let n = msg.n { rename(room, n) }
            caps[room] = msg.c ?? []
            if pendingRoom == room, pairState == .linking { pairState = .linked; Haptics.success() }
            // A hi sent on arrival crossed ours, and both sides already sent their snapshots: don't send it twice.
            // One sent right after pairing (no p) came before this phone could be read, so it gets one now.
            if msg.p == nil {
                send(room, hello)
                send(room, "snap", snapshot())
            }
        case "snap", "put":
            let recs = msg.recs ?? []
            apply(recs)
            fetchMissing(room, recs)
        case "bye": remove(room)
        case "want": serve(room, msg.hs ?? [])
        case "file": take(msg)
        case "ask": answer(room, msg)
        case "stop": if let id = msg.id { answering.removeValue(forKey: id)?.cancel() }
        default: break
        }
    }

    /// Tell the computers again what this phone can do (after the model or the sharing setting changed).
    func announce() { for p in pairings where (online[p.room] ?? 0) > 0 { send(p.room, hello) } }

    // MARK: Files

    private func fetchMissing(_ room: String, _ recs: [Rec]) {
        guard caps[room]?.contains("files") == true else { return }
        var want: [String] = []
        for r in recs where r.deletedAt == nil {
            for h in FileStore.refs(in: r.body ?? "") where !want.contains(h) && FileStore.meta(h) == nil {
                if let t = asked[h], Date.now.timeIntervalSince(t) < 60 { continue }
                asked[h] = .now
                want.append(h)
            }
        }
        stride(from: 0, to: want.count, by: 100).forEach { send(room, Msg(t: "want", hs: Array(want[$0..<min($0 + 100, want.count)]))) }
    }

    private func serve(_ room: String, _ hashes: [String]) {
        let piece = 256 * 1024
        Task { @MainActor in
            for h in hashes.prefix(500) where FileStore.isHash(h) {
                guard let m = FileStore.meta(h), let data = FileStore.data(h) else { continue }
                let of = max(1, (data.count + piece - 1) / piece)
                for i in 0..<of {
                    guard conns[room] != nil else { return }
                    let part = data.subdata(in: (i * piece)..<min((i + 1) * piece, data.count))
                    send(room, Msg(t: "file", h: h, nm: m.name, ty: m.type, sz: data.count, i: i, of: of, d: B64U.encode(part)))
                    // Let the socket drain between pieces rather than queueing a whole large file in memory.
                    try? await Task.sleep(for: .milliseconds(15))
                }
            }
        }
    }

    private func take(_ m: Msg) {
        guard let h = m.h, FileStore.isHash(h), let of = m.of, let i = m.i, let size = m.sz, let d = m.d.flatMap(B64U.decode),
              of >= 1, i >= 0, i < of, size <= FileStore.limit, of <= FileStore.limit / (256 * 1024) + 1, FileStore.meta(h) == nil else { return }
        var x = incoming[h] ?? (parts: [:], of: of, name: m.nm ?? "File", type: m.ty ?? "application/octet-stream", size: size, at: .now)
        guard x.of == of, x.parts[i] == nil else { return }
        x.parts[i] = d
        x.at = .now
        guard x.parts.count == of else { incoming[h] = x; return }
        incoming[h] = nil
        var all = Data(capacity: size)
        for k in 0..<of { guard let p = x.parts[k] else { return }; all.append(p) }
        // Checked against its hash before it's kept: a file can't be swapped for another on the way.
        guard all.count == size, FileStore.put(all, hash: h, name: x.name, type: x.type) else { return }
        asked[h] = nil
    }

    // MARK: The model, for computers

    /// A computer asked this phone's model a question. One at a time; the answer goes back as it's written.
    private func answer(_ room: String, _ m: Msg) {
        guard let id = m.id, let turns = m.msgs, !turns.isEmpty else { return }
        guard Self.sharesModel, Assistant.isAvailable else {
            return send(room, Msg(t: "done", id: id, full: "", err: "Your phone isn’t sharing its model. Turn it on in Monolith’s Settings on your phone."))
        }
        guard answering.isEmpty else {
            return send(room, Msg(t: "done", id: id, full: "", err: "Your phone is answering another question. Try again in a moment."))
        }
        let system = turns.filter { $0.role == "system" }.map(\.content).joined(separator: "\n\n")
        let talk = turns.filter { $0.role != "system" }
        // One question goes as it is; a conversation is written out, newest last, for the model to continue.
        let prompt = talk.count == 1 ? talk[0].content
            : talk.map { ($0.role == "assistant" ? "Assistant: " : "User: ") + $0.content }.joined(separator: "\n\n") + "\n\nAssistant:"
        answering[id] = Task { @MainActor [weak self] in
            var sent = Date.distantPast
            do {
                let full = try await Assistant.respond(instructions: system, prompt: prompt) { text in
                    guard let self, Date.now.timeIntervalSince(sent) > 0.15 else { return }
                    sent = .now
                    self.send(room, Msg(t: "tok", id: id, full: text))
                }
                if !Task.isCancelled { self?.send(room, Msg(t: "done", id: id, full: full)) }
            } catch {
                if !Task.isCancelled { self?.send(room, Msg(t: "done", id: id, full: "", err: error.localizedDescription)) }
            }
            self?.answering[id] = nil
        }
    }

    private func send(_ room: String, _ msg: Msg) {
        guard let c = conns[room] else { return }
        var msg = msg
        seq = Envelope.next(after: seq)
        msg.f = me
        msg.q = seq
        guard var plain = try? JSONEncoder().encode(msg) else { return }
        if let fill = Envelope.padding(for: plain.count) {
            msg.pad = fill
            plain = (try? JSONEncoder().encode(msg)) ?? plain
        }
        guard let box = try? LinkCrypto.seal(plain, key: c.key),
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
            // The code's room is only for the handshake. Anyone who saw the code knows it; only we two can work out this one.
            let room = r.privateRoom ? LinkCrypto.syncRoom(raw) : r.room
            let p = Pairing(room: room, key: B64U.encode(raw), name: r.name, relay: r.relay, linkedAt: .now)
            pendingRoom = room
            pendingCheck = r.privateRoom ? LinkCrypto.checkCode(raw) : nil
            pairings.removeAll { $0.room == p.room }
            pairings.append(p)
            save()
            scan()
            let unreachable = r.onLocalNetwork
                ? "Couldn’t reach your computer. Check both are on the same Wi-Fi, and that Monolith may use the local network (Settings › Privacy › Local Network)."
                : "Couldn’t reach the sync relay. Check your connection and try again."
            let frame = String(decoding: try JSONSerialization.data(withJSONObject: hello), as: UTF8.self)
            if r.privateRoom {
                // Say hello in the code's room, then leave it.
                guard let url = URL(string: "\(r.relay)/relay?room=\(r.room)") else { throw CocoaError(.coderInvalidValue) }
                let code = URLSession.shared.webSocketTask(with: url)
                code.resume()
                code.send(.string(frame)) { [weak self] error in
                    Task { @MainActor [weak self] in
                        if error != nil { self?.failPairing(room, unreachable); code.cancel(); return }
                        try? await Task.sleep(for: .seconds(2))
                        code.cancel(with: .normalClosure, reason: nil)
                    }
                }
                connect(p)
            } else {
                connect(p)
                conns[p.room]?.task.send(.string(frame)) { [weak self] error in
                    guard error != nil else { return }
                    Task { @MainActor [weak self] in self?.failPairing(room, unreachable) }
                }
            }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(15))
                if self.pendingRoom == room, self.pairState == .linking {
                    self.failPairing(room, r.onLocalNetwork
                        ? "Your computer didn’t answer. Make sure the code is still showing and both are on the same Wi-Fi, then scan again."
                        : "The computer didn’t answer. Make sure the code is still showing, then scan it again.")
                }
            }
        } catch {
            pairState = .failed("That code didn’t work. Show a new one on your computer and scan again.")
        }
    }

    private func failPairing(_ room: String, _ message: String) {
        guard pairState != .linked else { return }
        pairState = .failed(message)
        Haptics.error()
        remove(room)
    }

    func unlink(_ p: Pairing) {
        send(p.room, Msg(t: "bye"))
        remove(p.room)
    }

    private func remove(_ room: String) {
        conns.removeValue(forKey: room)?.task.cancel(with: .goingAway, reason: nil)
        online[room] = nil
        caps[room] = nil
        seen[room] = nil
        seenDirty = true
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

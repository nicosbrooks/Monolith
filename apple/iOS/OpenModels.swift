import Foundation
import Observation
import MLXLLM
import MLXLMCommon
import MLXHuggingFace
import HuggingFace
import Tokenizers

enum Tier: String { case fast, `default`, enhanced, more }

/// An open model the app can download and run on this device with MLX.
struct OpenModel: Identifiable, Hashable {
    let id: String // Hugging Face repo
    let name: String
    let tier: Tier
    let note: String
    /// Device memory it needs to run comfortably, in GB.
    let needsGB: Double
}

/// Open models, run on the device through Apple's MLX. Picking one is all a person does:
/// it downloads once the first time it's needed, then works offline.
@Observable
final class OpenModels {
    static let shared = OpenModels()

    /// Same tiers as the web app, so Fast / Default / Enhanced mean the same everywhere. All 2B or smaller:
    /// quick to download, fast to answer.
    static let catalog: [OpenModel] = [
        .init(id: "mlx-community/Qwen3.5-0.8B-4bit", name: "Qwen 3.5 0.8B", tier: .fast, note: "Instant answers, smallest download", needsGB: 3),
        // Liquid AI's LFM3: about 1 GB, fast on phones (the model Locally AI runs). Needs LFM3.swift until mlx-swift-lm ships it.
        .init(id: "LiquidAI/LFM3-1.7B-MLX-4bit", name: "LFM 3 1.7B", tier: .default, note: "Quick and accurate, about 1 GB", needsGB: 3),
        .init(id: "mlx-community/gemma-4-e2b-it-4bit", name: "Gemma 4 E2B", tier: .enhanced, note: "Sharpest writing and reasoning", needsGB: 6),
        // Default where LFM 3 won't fit.
        .init(id: "mlx-community/Qwen3.5-2B-4bit", name: "Qwen 3.5 2B", tier: .more, note: "Strong all-rounder", needsGB: 4),
    ]
    static let deviceGB = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
    static func fits(_ m: OpenModel) -> Bool { m.needsGB <= deviceGB + 0.5 }

    /// The model behind a tier on this device. Default steps down where it won't fit.
    static func model(for tier: Tier) -> OpenModel {
        let m = catalog.first { $0.tier == tier }!
        if tier == .default && !fits(m) {
            let smaller = catalog.first { $0.id == "mlx-community/Qwen3.5-2B-4bit" }!
            return fits(smaller) ? smaller : model(for: .fast)
        }
        return m
    }
    static var recommended: OpenModel { model(for: .default) }

    /// MLX needs the device's GPU; the Simulator doesn't provide one it can use.
    static var supported: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        true
        #endif
    }

    enum Phase: Equatable {
        case idle
        case loading(Double)
        case ready
        case failed(String)
    }
    private(set) var phase: Phase = .idle
    private(set) var loadedID: String?
    private(set) var preparingID: String?
    func isLoaded(_ id: String) -> Bool { loadedID == id && phase == .ready }

    @ObservationIgnored private var container: ModelContainer?
    @ObservationIgnored private var pending: Task<ModelContainer, Error>?
    @ObservationIgnored private var request = UUID()

    /// Download (first time only) and load `id`, reusing it if it's already in memory.
    /// The pinned mlx-swift-lm predates LFM3, so the app registers it before the first load.
    @ObservationIgnored private var registeredLFM3 = false

    func container(for id: String) async throws -> ModelContainer {
        if !registeredLFM3 { await LFM3Support.register(); registeredLFM3 = true }
        if let container, loadedID == id { return container }
        if let pending, preparingID == id { return try await pending.value }
        pending?.cancel()
        let token = UUID()
        request = token
        preparingID = id
        container = nil
        loadedID = nil
        phase = .loading(0)
        let configuration = LLMRegistry.shared.configuration(id: id)
        let task = Task {
            try await #huggingFaceLoadModelContainer(configuration: configuration) { progress in
                let p = progress.fractionCompleted
                Task { @MainActor in
                    if OpenModels.shared.request == token, case .loading = OpenModels.shared.phase { OpenModels.shared.phase = .loading(p) }
                }
            }
        }
        pending = task
        do {
            let c = try await task.value
            guard request == token else { throw CancellationError() }
            pending = nil
            container = c
            loadedID = id
            phase = .ready
            Self.remember(id)
            return c
        } catch {
            if request == token {
                pending = nil
                phase = .failed(error.localizedDescription)
            }
            throw error
        }
    }

    /// Models that have loaded on this device before, so warming one up never starts a surprise download.
    private static let loadedKey = "openModelsLoaded"
    static func onDevice(_ id: String) -> Bool { (UserDefaults.standard.stringArray(forKey: loadedKey) ?? []).contains(id) }
    private static func remember(_ id: String) {
        var ids = UserDefaults.standard.stringArray(forKey: loadedKey) ?? []
        if !ids.contains(id) { ids.append(id); UserDefaults.standard.set(ids, forKey: loadedKey) }
    }

    /// Load the model into memory ahead of the first question, if it's already downloaded.
    /// Loading takes a few seconds; doing it while someone types means the answer starts right away.
    func warm(_ id: String) {
        guard Self.onDevice(id), !isLoaded(id), preparingID != id || pending == nil else { return }
        Task { _ = try? await container(for: id) }
    }

    /// A chat session that keeps what the model has already read. Follow-ups in the same conversation
    /// only process the new words instead of rereading the whole context, so they start much faster.
    func session(model id: String, instructions: String) async throws -> ChatSession {
        let c = try await container(for: id)
        // Hybrid reasoning models (Qwen, LFM3) answer directly; notes and briefs don't need a visible chain of thought.
        return ChatSession(c, instructions: instructions, generateParameters: GenerateParameters(maxTokens: 384, temperature: 0.3), additionalContext: ["enable_thinking": false])
    }

    /// Answer `prompt`, calling `onText` with the text so far as each piece arrives.
    func respond(model id: String, instructions: String, prompt: String, onText: (@MainActor (String) -> Void)? = nil) async throws -> String {
        try await Self.stream(try await session(model: id, instructions: instructions), prompt: prompt, onText: onText)
    }

    static func stream(_ session: ChatSession, prompt: String, onText: (@MainActor (String) -> Void)?) async throws -> String {
        var raw = ""
        for try await chunk in session.streamResponse(to: prompt) {
            raw += chunk
            try Task.checkCancellation()
            if let onText { onText(visible(raw)) }
        }
        return visible(raw)
    }

    /// The answer without any reasoning block, including one still being written.
    static func visible(_ raw: String) -> String {
        var s = raw.replacingOccurrences(of: #"<think>[\s\S]*?</think>"#, with: "", options: .regularExpression)
        if let open = s.range(of: "<think>") { s = String(s[..<open.lowerBound]) }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

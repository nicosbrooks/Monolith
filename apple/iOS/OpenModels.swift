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

    /// Same tiers as the web app, so Fast / Default / Enhanced mean the same everywhere.
    static let catalog: [OpenModel] = [
        .init(id: "mlx-community/Qwen3.5-0.8B-4bit", name: "Qwen 3.5 0.8B", tier: .fast, note: "Instant answers, lightest download", needsGB: 3),
        // Liquid AI's LFM3: about 1 GB, fast on phones (the model Locally AI runs). Needs LFM3.swift until mlx-swift-lm ships it.
        .init(id: "LiquidAI/LFM3-1.7B-MLX-4bit", name: "LFM 3 1.7B", tier: .default, note: "Liquid AI’s fast on-device model, about 1 GB", needsGB: 3),
        .init(id: "mlx-community/gemma-4-e2b-it-4bit", name: "Gemma 4 E2B", tier: .more, note: "Google’s newest small model", needsGB: 6),
        .init(id: "mlx-community/Qwen3.5-4B-4bit", name: "Qwen 3.5 4B", tier: .enhanced, note: "Sharper writing and reasoning", needsGB: 8),
        .init(id: "mlx-community/Qwen3.5-2B-4bit", name: "Qwen 3.5 2B", tier: .more, note: "Strong all-rounder, lighter than Gemma 4", needsGB: 4),
        .init(id: "mlx-community/gemma-4-e4b-it-4bit", name: "Gemma 4 E4B", tier: .more, note: "Gemma 4’s larger mobile model", needsGB: 8),
        .init(id: "mlx-community/Qwen3-8B-4bit", name: "Qwen 3 8B", tier: .more, note: "Large, for iPad and Mac", needsGB: 12),
        .init(id: "mlx-community/Qwen3.5-9B-4bit", name: "Qwen 3.5 9B", tier: .more, note: "Largest, for iPad and Mac", needsGB: 16),
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
            return c
        } catch {
            if request == token {
                pending = nil
                phase = .failed(error.localizedDescription)
            }
            throw error
        }
    }

    /// Answer `prompt`, calling `onText` with the text so far as each piece arrives.
    func respond(model id: String, instructions: String, prompt: String, onText: (@MainActor (String) -> Void)? = nil) async throws -> String {
        let c = try await container(for: id)
        // Hybrid reasoning models (Qwen, LFM3) answer directly; notes and briefs don't need a visible chain of thought.
        let session = ChatSession(c, instructions: instructions, generateParameters: GenerateParameters(maxTokens: 384), additionalContext: ["enable_thinking": false])
        var raw = ""
        for try await chunk in session.streamResponse(to: prompt) {
            raw += chunk
            if let onText { onText(Self.visible(raw)) }
        }
        return Self.visible(raw)
    }

    /// The answer without any reasoning block, including one still being written.
    static func visible(_ raw: String) -> String {
        var s = raw.replacingOccurrences(of: #"<think>[\s\S]*?</think>"#, with: "", options: .regularExpression)
        if let open = s.range(of: "<think>") { s = String(s[..<open.lowerBound]) }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

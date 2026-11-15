import SwiftUI
import PencilKit

/// PencilKit canvas for scratch work. Draws with Apple Pencil; with no Pencil connected, a finger draws too.
struct SketchCanvas: UIViewRepresentable {
    @Binding var data: Data?

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawingPolicy = .default
        canvas.alwaysBounceVertical = true
        canvas.delegate = context.coordinator
        if let data, let d = try? PKDrawing(data: data) { canvas.drawing = d }
        context.coordinator.picker.setVisible(true, forFirstResponder: canvas)
        context.coordinator.picker.addObserver(canvas)
        DispatchQueue.main.async { canvas.becomeFirstResponder() }
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {}

    static func dismantleUIView(_ canvas: PKCanvasView, coordinator: Coordinator) {
        coordinator.picker.setVisible(false, forFirstResponder: canvas)
        coordinator.picker.removeObserver(canvas)
    }

    func makeCoordinator() -> Coordinator { Coordinator(data: $data) }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        let picker = PKToolPicker()
        var data: Binding<Data?>
        init(data: Binding<Data?>) { self.data = data }
        func canvasViewDrawingDidChange(_ canvas: PKCanvasView) {
            data.wrappedValue = canvas.drawing.strokes.isEmpty ? nil : canvas.drawing.dataRepresentation()
        }
    }
}

/// Read-only preview of a note's sketch, for when the canvas is closed.
struct SketchPreview: View {
    var data: Data
    var body: some View {
        if let d = try? PKDrawing(data: data), !d.bounds.isEmpty {
            Image(uiImage: d.image(from: d.bounds.insetBy(dx: -12, dy: -12), scale: 2))
                .resizable().scaledToFit()
                .frame(maxHeight: 220, alignment: .leading)
        }
    }
}

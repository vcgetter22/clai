import AppKit
import ClaiCore
import SwiftUI

/// `clai --render <folder>` draws the panel with sample data, light and dark, to PNG files and quits.
/// Used by CI for screenshots; the site's panel images come from it. (Offscreen drawing shows SwiftUI
/// views only, so system controls and the popover material are left out.)
@MainActor
enum Renderer {
    static func render(to folder: URL) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let state = AppState(sample: true)
        for (name, appearance, background) in [
            ("light", NSAppearance.Name.aqua, Color(hex: 0xF2F2F2)),
            ("dark", NSAppearance.Name.darkAqua, Color(hex: 0x262626)),
        ] {
            let scheme: ColorScheme = name == "dark" ? .dark : .light
            let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
            let view = PanelView(state: state, context: .popover)
                .environment(\.colorScheme, scheme)
                .background(shape.fill(background))
                .clipShape(shape)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            var image: NSImage?
            if let look = NSAppearance(named: appearance) {
                look.performAsCurrentDrawingAppearance { image = renderer.nsImage }
            } else {
                image = renderer.nsImage
            }
            guard let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else {
                FileHandle.standardError.write("clai: could not render the \(name) panel\n".data(using: .utf8)!)
                continue
            }
            try? png.write(to: folder.appendingPathComponent("panel-\(name).png"))
            print("rendered \(folder.appendingPathComponent("panel-\(name).png").path) (\(Int(image.size.width))x\(Int(image.size.height)) pt)")
        }
    }
}

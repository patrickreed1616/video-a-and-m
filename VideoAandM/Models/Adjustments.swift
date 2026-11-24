import Foundation

/// Global "lighting" adjustments applied to the whole video in preview and export.
struct Adjustments: Codable, Hashable, Sendable {
    /// CIExposureAdjust inputEV, -2...2
    var exposure: Double = 0
    /// CIColorControls inputBrightness, -0.5...0.5
    var brightness: Double = 0
    /// CIColorControls inputContrast, 0.5...1.5
    var contrast: Double = 1
    /// CIColorControls inputSaturation, 0...2
    var saturation: Double = 1

    static let neutral = Adjustments()
    var isNeutral: Bool { self == .neutral }
}

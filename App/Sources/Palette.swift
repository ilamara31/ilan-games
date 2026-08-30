import UIKit

/// Colours and sizing shared by the scene and the menu, kept in one place so the
/// native build stays visually identical to the original web game.
enum Palette {
    static let backdrop = UIColor(red: 0.043, green: 0.071, blue: 0.149, alpha: 1) // #0b1226
    static let skyTop = UIColor(red: 0.063, green: 0.125, blue: 0.290, alpha: 1)   // #10204a
    static let skyBottom = UIColor(red: 0.039, green: 0.059, blue: 0.141, alpha: 1) // #0a0f24
    static let gold = UIColor(red: 1.0, green: 0.835, blue: 0.290, alpha: 1)       // #ffd54a
    static let pink = UIColor(red: 1.0, green: 0.482, blue: 0.835, alpha: 1)       // #ff7bd5
    static let orange = UIColor(red: 1.0, green: 0.549, blue: 0.239, alpha: 1)     // #ff8c3d
    static let subtitle = UIColor(red: 0.780, green: 0.824, blue: 0.941, alpha: 1) // #c7d2f0

    /// The tower's colour ramp — one hue per block, matching the web original.
    static func block(_ index: Int, current: Bool = false) -> UIColor {
        let hue = CGFloat((index * 9 + 200) % 360) / 360
        return UIColor(hue: hue,
                       saturation: current ? 0.70 : 0.62,
                       brightness: current ? 0.62 : 0.58,
                       alpha: 1)
    }
}

enum Layout {
    /// Block height, and the playfield width cap that keeps the block's travel
    /// feeling the same on a big phone as on a small one.
    static let blockHeight: CGFloat = 34
    static let maxPlayfieldWidth: CGFloat = 480
    /// How close to the block below still counts as a perfect drop.
    static let perfectTolerance: CGFloat = 7
    static let baseSpeed: CGFloat = 3.0
    static let speedPerBlock: CGFloat = 0.06
    static let tutorialSpeed: CGFloat = 2.6
}

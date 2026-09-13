import SpriteKit

/// The tutorial's speech bubble. Sits under the notch / Dynamic Island and wraps
/// its text to the screen width.
final class CoachBubble: SKNode {

    private let background = SKShapeNode()
    private let label = SKLabelNode(fontNamed: "AvenirNext-DemiBold")

    override init() {
        super.init()
        background.fillColor = UIColor(red: 0.031, green: 0.047, blue: 0.118, alpha: 0.92)
        background.strokeColor = Palette.gold.withAlphaComponent(0.75)
        background.lineWidth = 2
        addChild(background)

        label.fontSize = 17
        label.fontColor = .white
        label.numberOfLines = 0
        label.horizontalAlignmentMode = .center
        label.verticalAlignmentMode = .center
        addChild(label)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func setMessage(_ text: String, in size: CGSize, safeTop: CGFloat, scale: CGFloat) {
        label.fontSize = 17 * scale
        label.preferredMaxLayoutWidth = min(size.width * 0.92, 520 * scale) - 28 * scale
        label.text = text
        layout(in: size, safeTop: safeTop, scale: scale)
    }

    func layout(in size: CGSize, safeTop: CGFloat, scale: CGFloat) {
        let maxWidth = min(size.width * 0.92, 520 * scale)
        let textHeight = max(label.frame.height, 20 * scale)
        let height = textHeight + 28 * scale

        background.path = CGPath(roundedRect: CGRect(x: -maxWidth / 2, y: -height / 2,
                                                     width: maxWidth, height: height),
                                 cornerWidth: 14 * scale, cornerHeight: 14 * scale, transform: nil)
        background.lineWidth = 2 * scale
        label.position = .zero
        // Camera-space: y is measured from the screen centre. iPads have no notch
        // and the status bar is hidden, so safeTop is 0 there — hence a floor, or
        // the bubble sits flush against the top edge.
        let topMargin = max(safeTop + 12 * scale, 28 * scale)
        position = CGPoint(x: 0, y: size.height / 2 - topMargin - height / 2)
    }
}

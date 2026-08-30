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

    func setMessage(_ text: String, in size: CGSize, safeTop: CGFloat) {
        let maxWidth = min(size.width * 0.92, 520)
        label.preferredMaxLayoutWidth = maxWidth - 28
        label.text = text
        layout(in: size, safeTop: safeTop)
    }

    func layout(in size: CGSize, safeTop: CGFloat) {
        let maxWidth = min(size.width * 0.92, 520)
        let textHeight = max(label.frame.height, 20)
        let height = textHeight + 28

        background.path = CGPath(roundedRect: CGRect(x: -maxWidth / 2, y: -height / 2,
                                                     width: maxWidth, height: height),
                                 cornerWidth: 14, cornerHeight: 14, transform: nil)
        label.position = .zero
        // Camera-space: y is measured from the screen centre.
        position = CGPoint(x: 0, y: size.height / 2 - safeTop - 12 - height / 2)
    }
}

import UIKit

/// UILabel with inset text — used for the confirmation toast.
final class PaddedLabel: UILabel {
    private let insets = UIEdgeInsets(top: 12, left: 18, bottom: 12, right: 18)

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }

    override var intrinsicContentSize: CGSize {
        let size = super.intrinsicContentSize
        return CGSize(width: size.width + insets.left + insets.right,
                      height: size.height + insets.top + insets.bottom)
    }

    override func textRect(forBounds bounds: CGRect, limitedToNumberOfLines lines: Int) -> CGRect {
        let rect = super.textRect(forBounds: bounds.inset(by: insets), limitedToNumberOfLines: lines)
        return rect.inset(by: UIEdgeInsets(top: -insets.top, left: -insets.left,
                                           bottom: -insets.bottom, right: -insets.right))
    }
}

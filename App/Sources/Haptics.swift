import UIKit

/// Generators are kept warm so the first drop of a run doesn't pay for setup.
final class Haptics {
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let medium = UIImpactFeedbackGenerator(style: .medium)
    private let notice = UINotificationFeedbackGenerator()

    init() { prepare() }

    func prepare() {
        light.prepare()
        medium.prepare()
        notice.prepare()
    }

    func landed() { light.impactOccurred(); light.prepare() }
    func perfect() { medium.impactOccurred(intensity: 1.0); medium.prepare() }
    func toppled() { notice.notificationOccurred(.error); notice.prepare() }
}

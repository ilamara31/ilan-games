import Foundation

/// Best score and tutorial state. UserDefaults rather than the web build's
/// localStorage — it survives app updates and is backed up with the device.
enum Scores {
    private static let bestKey = "stackTower.best"
    private static let tutorialKey = "stackTower.tutorialSeen"

    static var best: Int {
        get { UserDefaults.standard.integer(forKey: bestKey) }
        set { UserDefaults.standard.set(newValue, forKey: bestKey) }
    }

    static var hasSeenTutorial: Bool {
        UserDefaults.standard.bool(forKey: tutorialKey)
    }

    static func markTutorialSeen() {
        UserDefaults.standard.set(true, forKey: tutorialKey)
    }
}

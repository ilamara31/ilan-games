import Foundation

/// Best score and tutorial state.
///
/// The best score is stored **per account**, because a single shared key meant a
/// newly created account inherited whatever the previous player had scored on
/// this device. Signed-out play keeps its own separate "guest" best, so playing
/// without an account never writes into someone's account history either.
enum Scores {
    private static let legacyBestKey = "stackTower.best"
    private static let tutorialKey = "stackTower.tutorialSeen"

    /// One slot per account, plus a guest slot when nobody is signed in.
    private static var bestKey: String {
        guard let name = Account.name, !name.isEmpty else { return "stackTower.best.__guest__" }
        return "stackTower.best.\(name.lowercased())"
    }

    static var best: Int {
        get { UserDefaults.standard.integer(forKey: bestKey) }
        set { UserDefaults.standard.set(newValue, forKey: bestKey) }
    }

    /// Called once when an account signs in for the first time on this device.
    /// The pre-account guest score is offered to that account, but only if the
    /// account has no score of its own yet — never overwriting a real history.
    static func adoptGuestScoreIfUnset() {
        let guestBest = UserDefaults.standard.integer(forKey: "stackTower.best.__guest__")
        guard guestBest > 0, best == 0 else { return }
        best = guestBest
    }

    /// One-time move of the old single-key score into the guest slot, so an
    /// existing player's best is not silently lost when they update the app.
    static func migrateLegacyIfNeeded() {
        let legacy = UserDefaults.standard.integer(forKey: legacyBestKey)
        guard legacy > 0 else { return }
        let guestKey = "stackTower.best.__guest__"
        if UserDefaults.standard.integer(forKey: guestKey) < legacy {
            UserDefaults.standard.set(legacy, forKey: guestKey)
        }
        UserDefaults.standard.removeObject(forKey: legacyBestKey)
    }

    static var hasSeenTutorial: Bool {
        UserDefaults.standard.bool(forKey: tutorialKey)
    }

    static func markTutorialSeen() {
        UserDefaults.standard.set(true, forKey: tutorialKey)
    }
}

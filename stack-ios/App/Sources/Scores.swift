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

    /// Brings the signed-in account's best up to whatever the shared board says.
    ///
    /// The server is the authority, not this device. A player signing in on a
    /// phone that has never seen their account has a local best of 0, and
    /// without this their next run is announced as a personal best while the
    /// leaderboard already shows 122.
    ///
    /// There is deliberately NO carry-over from guest play. The guest slot holds
    /// whatever anybody scored while signed out on this device, so adopting it
    /// handed each new account the previous player's score.
    static func syncFromServer(_ serverBest: Int?) {
        guard let serverBest, serverBest > best else { return }
        best = serverBest
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

import Foundation

/// What gets shared when someone taps Share after a run.
enum ShareText {

    /// Where the invite points. The App Store link does not exist until the app
    /// is live, so this is the web version for now — swap in
    /// https://apps.apple.com/app/id<APP_ID> once App Store Connect issues one,
    /// and the share sheet starts driving installs instead of web plays.
    static let inviteURL = URL(string: "https://ilamara31.github.io/ilan-games/stack/")!

    static func message(score: Int, best: Int) -> String {
        let opener: String
        if score >= best && score > 0 {
            opener = "New personal best in Stack Tower — \(score) blocks!"
        } else if score > 0 {
            opener = "I stacked \(score) blocks in Stack Tower (best: \(best))."
        } else {
            opener = "I've been playing Stack Tower — my best is \(best) blocks."
        }
        return "\(opener) Think you can beat that? One tap to play:"
    }
}

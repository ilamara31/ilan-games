import Foundation

/// The game-over card used to say "TOPPLED!" every single time, which reads the
/// same whether you scored 2 or 200. These give the run a verdict and a reason
/// to go again.
enum GameOverMessage {

    struct Result {
        let headline: String
        let line: String
    }

    static func make(score: Int, best: Int, isNewBest: Bool) -> Result {
        if isNewBest && score > 0 {
            return Result(
                headline: "NEW BEST!",
                line: "\(score) blocks — your best yet. Can you go higher?"
            )
        }

        // How close this run came to the personal best, for the near-miss cases.
        let shortfall = best - score

        switch score {
        case 0...2:
            return Result(headline: "OOPS!",
                          line: "That was quick. Take your time — the block slows nothing down, but you can.")
        case 3...6:
            return Result(headline: "WOBBLY!",
                          line: "Getting the feel for it. Wait for the block to line up before you tap.")
        case 7...12:
            return Result(headline: "NOT BAD!",
                          line: "A real tower. Perfect drops keep it wide — that's the whole trick.")
        case 13...20:
            return Result(headline: "SOLID RUN!",
                          line: (1...3).contains(shortfall)
                              ? "So close — \(shortfall) more and you'd have beaten your best."
                              : "\(score) blocks up. Chain a few perfects and it widens back out.")
        case 21...35:
            return Result(headline: "TOWERING!",
                          line: (1...5).contains(shortfall)
                              ? "Agonising — \(shortfall) short of your best."
                              : "\(score) high. The higher you go the faster it moves.")
        case 36...60:
            return Result(headline: "SKYSCRAPER!",
                          line: (1...5).contains(shortfall)
                              ? "\(shortfall) off your best. One more run."
                              : "\(score) blocks. That's serious stacking.")
        default:
            return Result(headline: "INCREDIBLE!",
                          line: "\(score) blocks. Very few towers get this tall.")
        }
    }
}

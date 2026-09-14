import UIKit
import SpriteKit

/// Hosts the SpriteKit scene and the menu card over it.
final class GameViewController: UIViewController {

    private var skView: SKView!
    private var scene: GameScene!
    private let menu = MenuOverlayView()
    /// The score from the run just finished, for the share message.
    private var lastScore = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        // Before anything reads a best score: move the old single-key value into
        // the new per-account storage so existing players keep their record.
        Scores.migrateLegacyIfNeeded()
        view.backgroundColor = Palette.backdrop

        skView = SKView(frame: view.bounds)
        skView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        skView.ignoresSiblingOrder = true
        view.addSubview(skView)

        scene = GameScene(size: view.bounds.size)
        scene.scaleMode = .resizeFill
        scene.gameDelegate = self
        skView.presentScene(scene)

        menu.frame = view.bounds
        menu.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        menu.onStart = { [weak self] in self?.startRun(tutorial: false) }
        menu.onTutorial = { [weak self] in self?.startRun(tutorial: true) }
        menu.onAccount = { [weak self] in self?.presentAccount() }
        menu.onLeaderboard = { [weak self] in self?.presentLeaderboard() }
        menu.onShare = { [weak self] anchor in self?.presentShare(from: anchor) }
        view.addSubview(menu)

        NotificationCenter.default.addObserver(
            self, selector: #selector(appDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(appWillResignActive),
            name: UIApplication.willResignActiveNotification, object: nil)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        scene.size = view.bounds.size
        pushSafeAreaInsets()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        pushSafeAreaInsets()
    }

    private func pushSafeAreaInsets() {
        scene.updateSafeArea(top: view.safeAreaInsets.top, bottom: view.safeAreaInsets.bottom)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Straight into the tutorial the first time, like the web build did.
        if Scores.hasSeenTutorial {
            menu.showTitle(best: Scores.best)
        } else {
            startRun(tutorial: true)
        }
    }

    private func presentAccount() {
        let auth = AuthViewController()
        auth.onAccountChanged = { [weak self] message in
            guard let self else { return }
            // Refresh first: the button was still showing the previous player's
            // name after signing out or deleting.
            self.menu.refreshAccountButton()
            self.menu.refreshBest()
            if let message { self.toast(message) }
        }
        present(darkSheet(auth), animated: true)
    }

    /// A brief confirmation over the title card. Sign-out and deletion used to
    /// happen in complete silence, which read as the button not working.
    private func toast(_ message: String) {
        let label = PaddedLabel()
        label.text = message
        label.font = .systemFont(ofSize: 15, weight: .semibold)
        label.textColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.backgroundColor = UIColor(red: 0.09, green: 0.11, blue: 0.22, alpha: 0.97)
        label.layer.cornerRadius = 14
        label.layer.masksToBounds = true
        label.layer.borderWidth = 1
        label.layer.borderColor = Palette.gold.withAlphaComponent(0.6).cgColor
        label.alpha = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -28),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
        ])

        UIView.animate(withDuration: 0.25) { label.alpha = 1 }
        UIView.animate(withDuration: 0.35, delay: 3.2, options: []) {
            label.alpha = 0
        } completion: { _ in
            label.removeFromSuperview()
        }
    }

    /// The system share sheet — WhatsApp, Messages, anything installed.
    private func presentShare(from anchor: UIView) {
        let items: [Any] = [
            ShareText.message(score: lastScore, best: Scores.best),
            ShareText.inviteURL,
        ]
        let share = UIActivityViewController(activityItems: items, applicationActivities: nil)
        // On iPad this presents as a popover, and an unanchored popover is a crash,
        // not a layout glitch.
        share.popoverPresentationController?.sourceView = anchor
        share.popoverPresentationController?.sourceRect = anchor.bounds
        present(share, animated: true)
    }

    private func presentLeaderboard() {
        present(darkSheet(LeaderboardViewController()), animated: true)
    }

    /// The sheets sit on the game's dark backdrop, so the navigation bar needs
    /// matching colours — the default is dark text on dark.
    private func darkSheet(_ root: UIViewController) -> UINavigationController {
        let nav = UINavigationController(rootViewController: root)
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = Palette.backdrop
        appearance.titleTextAttributes = [.foregroundColor: UIColor.white]
        appearance.largeTitleTextAttributes = [.foregroundColor: UIColor.white]
        nav.navigationBar.standardAppearance = appearance
        nav.navigationBar.scrollEdgeAppearance = appearance
        nav.navigationBar.compactAppearance = appearance
        nav.navigationBar.tintColor = Palette.gold
        nav.overrideUserInterfaceStyle = .dark
        return nav
    }

    private func startRun(tutorial: Bool) {
        menu.isHidden = true
        scene.startRun(tutorial: tutorial)
    }

    @objc private func appDidBecomeActive() { scene.resumeAudio() }
    @objc private func appWillResignActive() { scene.pauseAudio() }

    // The game is a portrait tower; full-screen with no status bar.
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
}

extension GameViewController: GameSceneDelegate {
    func gameSceneDidEndRun(_ scene: GameScene, score: Int, best: Int, isNewBest: Bool) {
        lastScore = score
        menu.showGameOver(score: score, best: best, isNewBest: isNewBest)
        // Only the personal best goes up, matching the website's behaviour.
        Task { await Account.submit(score: best) }
    }

    func gameSceneDidFinishTutorial(_ scene: GameScene) {
        menu.showTitle(best: Scores.best)
    }
}

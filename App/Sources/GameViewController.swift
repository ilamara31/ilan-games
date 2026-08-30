import UIKit
import SpriteKit

/// Hosts the SpriteKit scene and the menu card over it.
final class GameViewController: UIViewController {

    private var skView: SKView!
    private var scene: GameScene!
    private let menu = MenuOverlayView()

    override func viewDidLoad() {
        super.viewDidLoad()
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
    func gameSceneDidEndRun(_ scene: GameScene, score: Int, best: Int) {
        menu.showGameOver(score: score, best: best)
    }

    func gameSceneDidFinishTutorial(_ scene: GameScene) {
        menu.showTitle(best: Scores.best)
    }
}

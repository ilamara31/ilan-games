import UIKit
import WebKit

/// Full-screen host for the game. The web layer draws everything; this side owns
/// the chrome (status bar, home indicator, safe areas) and the haptics.
final class GameViewController: UIViewController {

    private var webView: WKWebView!
    private let backdrop = UIColor(red: 0.043, green: 0.071, blue: 0.149, alpha: 1) // #0b1226

    // Kept warm so the first tap of a run doesn't pay for generator setup.
    private let lightTap = UIImpactFeedbackGenerator(style: .light)
    private let heavyTap = UIImpactFeedbackGenerator(style: .medium)
    private let notice = UINotificationFeedbackGenerator()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = backdrop

        guard let www = Bundle.main.url(forResource: "www", withExtension: nil) else {
            fatalError("www/ is missing from the app bundle")
        }

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(root: www), forURLScheme: BundleSchemeHandler.scheme)
        config.userContentController.add(self, name: "haptic")
        // The game's sound effects are triggered by taps, so no gesture gate is needed.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = backdrop
        webView.scrollView.backgroundColor = backdrop
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = self
        view.addSubview(webView)

        webView.load(URLRequest(url: BundleSchemeHandler.startURL))

        [lightTap, heavyTap].forEach { $0.prepare() }
        notice.prepare()
    }

    // The game is a portrait tower; full-screen with no status bar.
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
}

extension GameViewController: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "haptic", let kind = message.body as? String else { return }
        switch kind {
        case "tick":     lightTap.impactOccurred(); lightTap.prepare()
        case "perfect":  heavyTap.impactOccurred(intensity: 1.0); heavyTap.prepare()
        case "over":     notice.notificationOccurred(.error); notice.prepare()
        default:         break
        }
    }
}

extension GameViewController: WKNavigationDelegate {
    /// Everything ships in the bundle; nothing should ever navigate out.
    func webView(_ webView: WKWebView,
                 decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let isLocal = action.request.url?.scheme == BundleSchemeHandler.scheme
        decisionHandler(isLocal ? .allow : .cancel)
    }
}

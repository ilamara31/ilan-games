import UIKit

/// The title / game-over card. Native UIKit rather than the web build's HTML
/// overlay, and it uses SF Symbols instead of emoji so glyphs never go missing.
final class MenuOverlayView: UIView {

    var onStart: (() -> Void)?
    var onTutorial: (() -> Void)?
    var onAccount: (() -> Void)?
    var onLeaderboard: (() -> Void)?
    /// Hands back the button so the share sheet can anchor to it — an unanchored
    /// popover crashes on iPad.
    var onShare: ((UIView) -> Void)?

    private let titleLabel = UILabel()
    private let gradientLayer = CAGradientLayer()
    private let bodyLabel = UILabel()
    private let scoreLabel = UILabel()
    private let startButton = UIButton(type: .system)
    private let tutorialButton = UIButton(type: .system)
    private let accountButton = UIButton(type: .system)
    private let leaderboardButton = UIButton(type: .system)
    private let shareButton = UIButton(type: .system)
    private let actionRow = UIStackView()
    private let secondaryRow = UIStackView()
    private let column = UIStackView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0.031, green: 0.039, blue: 0.102, alpha: 0.55)
        build()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private func build() {
        titleLabel.font = .systemFont(ofSize: 46, weight: .black)
        titleLabel.textAlignment = .center
        titleLabel.text = "STACK TOWER"
        titleLabel.adjustsFontSizeToFitWidth = true
        titleLabel.minimumScaleFactor = 0.6

        // Gold-to-pink gradient masked by the title's glyphs.
        gradientLayer.colors = [Palette.gold.cgColor, Palette.pink.cgColor]
        gradientLayer.startPoint = CGPoint(x: 0, y: 0.5)
        gradientLayer.endPoint = CGPoint(x: 1, y: 0.5)
        let gradientHost = UIView()
        gradientHost.layer.addSublayer(gradientLayer)
        gradientHost.mask = titleLabel
        gradientHost.translatesAutoresizingMaskIntoConstraints = false
        gradientHost.heightAnchor.constraint(equalToConstant: 58).isActive = true

        bodyLabel.font = .systemFont(ofSize: 16)
        bodyLabel.textColor = Palette.subtitle
        bodyLabel.numberOfLines = 0
        bodyLabel.textAlignment = .center

        scoreLabel.numberOfLines = 0
        scoreLabel.textAlignment = .center
        scoreLabel.textColor = Palette.subtitle

        configureStartButton()
        configureTutorialButton()
        configureSecondaryRow()
        configureShareButton()

        actionRow.axis = .horizontal
        actionRow.spacing = 10
        actionRow.alignment = .center
        [startButton, shareButton].forEach(actionRow.addArrangedSubview)

        column.axis = .vertical
        column.alignment = .center
        column.spacing = 16
        column.translatesAutoresizingMaskIntoConstraints = false
        [gradientHost, bodyLabel, actionRow, scoreLabel, secondaryRow].forEach(column.addArrangedSubview)
        column.setCustomSpacing(22, after: bodyLabel)
        addSubview(column)

        NSLayoutConstraint.activate([
            column.centerYAnchor.constraint(equalTo: centerYAnchor),
            column.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 24),
            column.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -24),
            gradientHost.widthAnchor.constraint(equalTo: column.widthAnchor),
            bodyLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
        ])
    }

    private func configureStartButton() {
        var config = UIButton.Configuration.filled()
        config.title = "STACK"
        config.image = UIImage(systemName: "play.fill")
        config.imagePlacement = .trailing
        config.imagePadding = 8
        config.baseBackgroundColor = Palette.gold
        config.baseForegroundColor = UIColor(red: 0.165, green: 0.082, blue: 0, alpha: 1)
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(top: 15, leading: 44, bottom: 15, trailing: 44)
        config.attributedTitle = AttributedString("STACK", attributes: .init([
            .font: UIFont.systemFont(ofSize: 20, weight: .black)
        ]))
        startButton.configuration = config
        startButton.addAction(UIAction { [weak self] _ in self?.onStart?() }, for: .touchUpInside)
    }

    private func configureTutorialButton() {
        var config = UIButton.Configuration.gray()
        config.image = UIImage(systemName: "book")
        config.imagePadding = 8
        config.cornerStyle = .capsule
        config.baseForegroundColor = UIColor(red: 0.875, green: 0.894, blue: 1, alpha: 1)
        config.baseBackgroundColor = UIColor(white: 1, alpha: 0.08)
        config.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 13, bottom: 10, trailing: 13)
        config.titleLineBreakMode = .byClipping
        config.attributedTitle = AttributedString("Tutorial", attributes: .init([
            .font: UIFont.systemFont(ofSize: 14, weight: .semibold)
        ]))
        tutorialButton.configuration = config
        tutorialButton.titleLabel?.numberOfLines = 1
        tutorialButton.setContentCompressionResistancePriority(.required, for: .horizontal)
        tutorialButton.addAction(UIAction { [weak self] _ in self?.onTutorial?() }, for: .touchUpInside)
    }

    private func configureSecondaryRow() {
        func ghost(_ title: String, _ symbol: String) -> UIButton {
            let button = UIButton(type: .system)
            var config = UIButton.Configuration.gray()
            config.image = UIImage(systemName: symbol)
            config.imagePadding = 6
            config.cornerStyle = .capsule
            config.baseForegroundColor = UIColor(red: 0.875, green: 0.894, blue: 1, alpha: 1)
            config.baseBackgroundColor = UIColor(white: 1, alpha: 0.08)
            config.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 13, bottom: 10, trailing: 13)
            config.titleLineBreakMode = .byClipping
            config.attributedTitle = AttributedString(title, attributes: .init([
                .font: UIFont.systemFont(ofSize: 14, weight: .semibold)
            ]))
            button.configuration = config
            button.titleLabel?.numberOfLines = 1
            button.setContentCompressionResistancePriority(.required, for: .horizontal)
            return button
        }

        accountButton.configuration = ghost("Sign in", "person.crop.circle").configuration
        accountButton.addAction(UIAction { [weak self] _ in self?.onAccount?() }, for: .touchUpInside)

        leaderboardButton.configuration = ghost("Leaderboard", "trophy").configuration
        leaderboardButton.addAction(UIAction { [weak self] _ in self?.onLeaderboard?() }, for: .touchUpInside)

        secondaryRow.axis = .horizontal
        secondaryRow.spacing = 8
        secondaryRow.alignment = .center
        secondaryRow.distribution = .equalSpacing
        [tutorialButton, accountButton, leaderboardButton].forEach(secondaryRow.addArrangedSubview)
    }

    private func configureShareButton() {
        var config = UIButton.Configuration.filled()
        config.image = UIImage(systemName: "square.and.arrow.up")
        config.baseBackgroundColor = UIColor(white: 1, alpha: 0.12)
        config.baseForegroundColor = .white
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(top: 15, leading: 20, bottom: 15, trailing: 20)
        shareButton.configuration = config
        shareButton.accessibilityLabel = "Share your score"
        shareButton.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.onShare?(self.shareButton)
        }, for: .touchUpInside)
    }

    /// The best line belongs to whoever is signed in now, so it has to be redrawn
    /// when the account changes — not just when a run ends.
    func refreshBest() {
        guard !isHidden, titleLabel.text == "STACK TOWER" else { return }
        let best = Scores.best
        scoreLabel.attributedText = best > 0 ? NSAttributedString(
            string: "Best: \(best)",
            attributes: [.font: UIFont.systemFont(ofSize: 16)]
        ) : nil
        shareButton.isHidden = best == 0
    }

    /// Reflects who is signed in, so the button reads as an account button once you are.
    func refreshAccountButton() {
        let title = Account.name.map { String($0.prefix(12)) } ?? "Sign in"
        accountButton.configuration?.attributedTitle = AttributedString(title, attributes: .init([
            .font: UIFont.systemFont(ofSize: 14, weight: .semibold)
        ]))
        accountButton.configuration?.image = UIImage(
            systemName: Account.isSignedIn ? "person.crop.circle.fill" : "person.crop.circle")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if let host = titleLabel.superview {
            titleLabel.frame = host.bounds
            gradientLayer.frame = host.bounds
        }
    }

    // MARK: - States

    func showTitle(best: Int) {
        titleLabel.text = "STACK TOWER"
        bodyLabel.text = "Tap anywhere to drop the moving block. Line it up — overhang gets sliced off and the block shrinks. Perfect stacks keep full width and build a combo."
        setStartTitle("STACK")
        scoreLabel.attributedText = best > 0 ? NSAttributedString(
            string: "Best: \(best)",
            attributes: [.font: UIFont.systemFont(ofSize: 16)]
        ) : nil
        tutorialButton.isHidden = false
        shareButton.isHidden = Scores.best == 0
        refreshAccountButton()
        isHidden = false
    }

    func showGameOver(score: Int, best: Int, isNewBest: Bool) {
        let message = GameOverMessage.make(score: score, best: best, isNewBest: isNewBest)
        titleLabel.text = message.headline
        bodyLabel.text = message.line
        setStartTitle("STACK AGAIN")

        let text = NSMutableAttributedString(
            string: "\(score)\n",
            attributes: [.font: UIFont.systemFont(ofSize: 50, weight: .black),
                         .foregroundColor: Palette.gold]
        )
        text.append(NSAttributedString(
            string: "blocks • Best: \(best)",
            attributes: [.font: UIFont.systemFont(ofSize: 16),
                         .foregroundColor: Palette.subtitle]
        ))
        scoreLabel.attributedText = text
        tutorialButton.isHidden = true
        shareButton.isHidden = false
        refreshAccountButton()
        isHidden = false
    }

    private func setStartTitle(_ title: String) {
        startButton.configuration?.attributedTitle = AttributedString(title, attributes: .init([
            .font: UIFont.systemFont(ofSize: 20, weight: .black)
        ]))
    }
}

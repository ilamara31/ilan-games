import UIKit

/// Username + password, matching the website's accounts. The backend creates the
/// account when the name is free, so one form covers both signing in and joining.
final class AuthViewController: UIViewController {

    var onSignedIn: (() -> Void)?

    private let nameField = UITextField()
    private let passwordField = UITextField()
    private let statusLabel = UILabel()
    private let submitButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)

    @objc private func closeTapped() { dismiss(animated: true) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Palette.backdrop
        title = Account.isSignedIn ? "Account" : "Sign in"

        navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "Close", style: .plain, target: self, action: #selector(closeTapped))

        if Account.isSignedIn {
            buildSignedInState()
        } else {
            buildForm()
        }
    }

    // MARK: - Signed in

    private func buildSignedInState() {
        let who = UILabel()
        who.text = "Signed in as \(Account.name ?? "")"
        who.font = .systemFont(ofSize: 20, weight: .bold)
        who.textColor = .white
        who.textAlignment = .center

        let note = UILabel()
        note.text = "Your best score posts to the shared leaderboard — the same board as the website."
        note.font = .systemFont(ofSize: 15)
        note.textColor = Palette.subtitle
        note.numberOfLines = 0
        note.textAlignment = .center

        let signOut = UIButton(type: .system)
        var config = UIButton.Configuration.gray()
        config.title = "Sign out"
        config.baseForegroundColor = .white
        config.cornerStyle = .capsule
        config.contentInsets = .init(top: 12, leading: 28, bottom: 12, trailing: 28)
        signOut.configuration = config
        signOut.addAction(UIAction { [weak self] _ in
            Account.signOut()
            self?.dismiss(animated: true)
        }, for: .touchUpInside)

        // Apple requires an in-app way to delete an account (Guideline 5.1.1(v)).
        let delete = UIButton(type: .system)
        var deleteConfig = UIButton.Configuration.plain()
        deleteConfig.title = "Delete account"
        deleteConfig.baseForegroundColor = .systemRed
        delete.configuration = deleteConfig
        delete.addAction(UIAction { [weak self] _ in self?.confirmDelete() }, for: .touchUpInside)

        stack([who, note, signOut, delete])
    }

    private func confirmDelete() {
        let alert = UIAlertController(
            title: "Delete account?",
            message: "This removes your account and its scores. It can't be undone.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in
            self?.performDelete()
        })
        present(alert, animated: true)
    }

    private func performDelete() {
        guard let name = Account.name, let password = Account.password else { return }
        Task { @MainActor in
            let deleted = await Supabase.deleteAccount(name: name, password: password)
            if deleted {
                Account.signOut()
                dismiss(animated: true)
            } else {
                let alert = UIAlertController(
                    title: "Couldn't delete the account",
                    message: "The server didn't complete the request. Please try again, or contact support from the game's website.",
                    preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default))
                present(alert, animated: true)
            }
        }
    }

    // MARK: - Sign-in form

    private func buildForm() {
        let blurb = UILabel()
        blurb.text = "Use the same username and password as the Ilan Games website — one leaderboard across web and iPhone. A new username creates an account."
        blurb.font = .systemFont(ofSize: 15)
        blurb.textColor = Palette.subtitle
        blurb.numberOfLines = 0
        blurb.textAlignment = .center

        configure(nameField, placeholder: "Username")
        nameField.autocapitalizationType = .none
        nameField.autocorrectionType = .no
        nameField.textContentType = .username
        nameField.returnKeyType = .next

        configure(passwordField, placeholder: "Password")
        passwordField.isSecureTextEntry = true
        passwordField.textContentType = .password
        passwordField.returnKeyType = .go
        passwordField.addAction(UIAction { [weak self] _ in self?.submit() }, for: .primaryActionTriggered)

        statusLabel.font = .systemFont(ofSize: 14)
        statusLabel.textColor = .systemOrange
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center

        var config = UIButton.Configuration.filled()
        config.title = "Continue"
        config.baseBackgroundColor = Palette.gold
        config.baseForegroundColor = UIColor(red: 0.165, green: 0.082, blue: 0, alpha: 1)
        config.cornerStyle = .capsule
        config.contentInsets = .init(top: 14, leading: 40, bottom: 14, trailing: 40)
        submitButton.configuration = config
        submitButton.addAction(UIAction { [weak self] _ in self?.submit() }, for: .touchUpInside)

        stack([blurb, nameField, passwordField, submitButton, spinner, statusLabel])
    }

    private func configure(_ field: UITextField, placeholder: String) {
        field.placeholder = placeholder
        field.borderStyle = .roundedRect
        field.backgroundColor = UIColor(white: 1, alpha: 0.08)
        field.textColor = .white
        field.attributedPlaceholder = NSAttributedString(
            string: placeholder, attributes: [.foregroundColor: Palette.subtitle.withAlphaComponent(0.7)])
        field.translatesAutoresizingMaskIntoConstraints = false
        field.heightAnchor.constraint(equalToConstant: 46).isActive = true
    }

    private func stack(_ views: [UIView]) {
        let column = UIStackView(arrangedSubviews: views)
        column.axis = .vertical
        column.spacing = 16
        column.alignment = .fill
        column.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 32),
            column.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            column.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
        ])
    }

    private func submit() {
        let name = nameField.text?.trimmingCharacters(in: .whitespaces) ?? ""
        let password = passwordField.text ?? ""

        if let problem = Account.validationError(name: name, password: password) {
            statusLabel.text = problem
            return
        }

        statusLabel.text = nil
        spinner.startAnimating()
        submitButton.isEnabled = false

        Task { @MainActor in
            let result = await Supabase.authenticate(name: name, password: password)
            spinner.stopAnimating()
            submitButton.isEnabled = true

            switch result {
            case .created, .signedIn:
                Account.signIn(name: name, password: password)
                // Push the local best up to the shared board straight away.
                let best = Scores.best
                if best > 0 { await Supabase.postScore(name: name, password: password, score: best) }
                onSignedIn?()
                dismiss(animated: true)
            case .wrongPassword:
                statusLabel.text = "Wrong password for “\(name)”. Passwords can't be recovered."
            case .invalid:
                statusLabel.text = "That username or password isn't allowed."
            case .failed(let message):
                statusLabel.text = message
            }
        }
    }
}

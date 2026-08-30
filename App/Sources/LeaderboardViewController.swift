import UIKit

/// The shared board — the same Supabase table the website reads, so web and iOS
/// scores sit in one list.
final class LeaderboardViewController: UIViewController {

    private let tableView = UITableView(frame: .zero, style: .plain)
    private let spinner = UIActivityIndicatorView(style: .large)
    private let messageLabel = UILabel()
    private var entries: [Supabase.Entry] = []

    @objc private func closeTapped() { dismiss(animated: true) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Palette.backdrop
        title = "Leaderboard"

        navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "Close", style: .plain, target: self, action: #selector(closeTapped))

        tableView.frame = view.bounds
        tableView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        tableView.backgroundColor = .clear
        tableView.dataSource = self
        tableView.separatorColor = UIColor(white: 1, alpha: 0.08)
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "row")
        view.addSubview(tableView)

        messageLabel.textAlignment = .center
        messageLabel.textColor = Palette.subtitle
        messageLabel.numberOfLines = 0
        messageLabel.font = .systemFont(ofSize: 15)
        messageLabel.frame = view.bounds.insetBy(dx: 32, dy: 0)
        messageLabel.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        messageLabel.isHidden = true
        view.addSubview(messageLabel)

        spinner.center = view.center
        spinner.autoresizingMask = [.flexibleTopMargin, .flexibleBottomMargin,
                                    .flexibleLeftMargin, .flexibleRightMargin]
        spinner.color = .white
        view.addSubview(spinner)

        load()
    }

    private func load() {
        spinner.startAnimating()
        messageLabel.isHidden = true
        Task { @MainActor in
            do {
                // Guests appear on the web board; keep them, they're real scores.
                entries = try await Supabase.leaderboard()
                spinner.stopAnimating()
                if entries.isEmpty {
                    show("No scores yet. Be the first.")
                } else {
                    tableView.reloadData()
                }
            } catch {
                spinner.stopAnimating()
                show("Couldn't load the leaderboard.\nCheck your connection and try again.")
            }
        }
    }

    private func show(_ text: String) {
        messageLabel.text = text
        messageLabel.isHidden = false
    }
}

extension LeaderboardViewController: UITableViewDataSource {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        entries.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
        let entry = entries[indexPath.row]
        let isMe = entry.name == Account.name

        var content = UIListContentConfiguration.valueCell()
        content.text = "\(indexPath.row + 1).  \(entry.name)"
        content.secondaryText = "\(entry.score)"
        content.textProperties.color = isMe ? Palette.gold : .white
        content.textProperties.font = .systemFont(ofSize: 17, weight: isMe ? .bold : .regular)
        content.secondaryTextProperties.color = Palette.subtitle
        content.secondaryTextProperties.font = .systemFont(ofSize: 17, weight: .semibold)
        cell.contentConfiguration = content

        cell.backgroundColor = isMe ? UIColor(white: 1, alpha: 0.06) : .clear
        cell.selectionStyle = .none
        return cell
    }
}

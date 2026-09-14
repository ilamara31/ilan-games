import Foundation

/// Talks to the same Supabase project the website uses, so the leaderboard is one
/// shared board across web and iOS.
///
/// This backend is the "legacy" shape: there is no `account_signup` / `account_login`,
/// only `account_auth`, which creates the account when the name is free and
/// otherwise checks the password.
enum Supabase {

    // The publishable key is browser-safe by design and is already shipped in the
    // website's JavaScript; row-level security is what protects the data.
    static let url = URL(string: "https://xanrofecdpoljnerpsow.supabase.co")!
    static let key = "sb_publishable_jff4Q2OLVzIf0Cr1FILZyQ_vgy8xRrT"

    /// This game's key in the shared `leaderboard` table — matches the web build.
    static let gameID = "stack"

    enum AuthResult {
        case created        // name was free; the account now exists
        case signedIn       // name existed and the password matched
        case wrongPassword
        case invalid
        case failed(String)
    }

    struct Entry: Decodable, Hashable {
        let name: String
        let game: String
        let score: Int
        let isGuest: Bool

        enum CodingKeys: String, CodingKey {
            case name, game, score
            case isGuest = "is_guest"
        }
    }

    /// iOS very often fails the first request of a session with
    /// `networkConnectionLost` (-1005) — a stale connection in the URL cache,
    /// nothing to do with the user actually being offline. Reporting that as
    /// "you're offline" to someone who has just created an account is simply
    /// wrong. The website's own callRpc retries three times for the same
    /// reason; this is that logic, ported.
    private static let retriableCodes: Set<URLError.Code> = [
        .networkConnectionLost, .timedOut, .cannotConnectToHost,
        .dnsLookupFailed, .cannotFindHost, .notConnectedToInternet,
    ]

    private static func send(_ request: URLRequest, attempts: Int = 3) async throws -> (Data, URLResponse) {
        var lastError: Error = URLError(.unknown)
        for attempt in 0..<attempts {
            do {
                return try await URLSession.shared.data(for: request)
            } catch {
                lastError = error
                guard let code = (error as? URLError)?.code, retriableCodes.contains(code) else { throw error }
                // 350ms, 700ms — matching the website's backoff.
                try? await Task.sleep(nanoseconds: UInt64(350_000_000 * (attempt + 1)))
            }
        }
        throw lastError
    }

    private static func request(path: String, method: String, body: [String: Any?]?) throws -> URLRequest {
        var request = URLRequest(url: url.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue(key, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body.mapValues { $0 ?? NSNull() })
        }
        return request
    }

    // MARK: - Accounts

    static func authenticate(name: String, password: String) async -> AuthResult {
        do {
            let request = try request(path: "rest/v1/rpc/account_auth", method: "POST", body: [
                "p_name": name, "p_password": password, "p_recovery": nil,
            ])
            let (data, response) = try await send(request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return .failed("The server rejected that request.")
            }
            // The RPC answers with a bare JSON string.
            let answer = (String(data: data, encoding: .utf8) ?? "")
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"\n "))
            switch answer {
            case "created": return .created
            case "ok": return .signedIn
            case "wrong": return .wrongPassword
            case "invalid": return .invalid
            default: return .failed("Unexpected reply from the server.")
            }
        } catch {
            return .failed(friendly(error))
        }
    }

    /// Existing usernames that differ from `name` only by capitalisation.
    ///
    /// Accounts are case-sensitive server-side, so "Mags" and "mags" are two
    /// different people with two different passwords and two different scores —
    /// which is almost never what someone typing their name again intends. This
    /// lets the sign-in screen warn before creating the second one.
    ///
    /// Only players who already hold a score are visible to the public key, so
    /// this catches the common case rather than every case. It is a warning, not
    /// a guarantee.
    /// Returns every existing name that folds to the same string, INCLUDING an
    /// exact match. The caller needs the exact match to tell "signing in to my
    /// own account" apart from "about to create a near-duplicate".
    static func namesFolding(to name: String) async -> [String] {
        var components = URLComponents(url: url.appendingPathComponent("rest/v1/leaderboard"),
                                       resolvingAgainstBaseURL: false)!
        components.queryItems = [
            .init(name: "select", value: "name"),
            .init(name: "name", value: "ilike.\(name)"),
            .init(name: "limit", value: "50"),
        ]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 12
        request.setValue(key, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")

        struct Row: Decodable { let name: String }
        guard let (data, _) = try? await send(request, attempts: 2),
              let rows = try? JSONDecoder().decode([Row].self, from: data) else { return [] }

        var seen = Set<String>()
        return rows.map(\.name)
            .filter { $0.lowercased() == name.lowercased() }
            .filter { seen.insert($0).inserted }
    }

    /// This player's best score on the shared board, or nil if they have none.
    ///
    /// Signing in has to start from the server's number, not the device's.
    /// Without this, a player signing in on a phone that has never seen their
    /// account starts from a local best of 0, so their very next run is
    /// announced as a personal best even though the board says 122.
    static func bestScore(for name: String) async -> Int? {
        var components = URLComponents(url: url.appendingPathComponent("rest/v1/leaderboard"),
                                       resolvingAgainstBaseURL: false)!
        components.queryItems = [
            .init(name: "select", value: "score"),
            .init(name: "name", value: "eq.\(name)"),
            .init(name: "game", value: "eq.\(gameID)"),
            .init(name: "order", value: "score.desc"),
            .init(name: "limit", value: "1"),
        ]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 15
        request.setValue(key, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")

        struct Row: Decodable { let score: Int }
        guard let (data, _) = try? await send(request, attempts: 2),
              let rows = try? JSONDecoder().decode([Row].self, from: data) else { return nil }
        return rows.first?.score
    }

    /// Whether any account already exists whose name folds to this one.
    ///
    /// Uses the `account_name_taken` RPC when it is installed, because only the
    /// server can see accounts that hold no score yet. Falls back to scanning
    /// the leaderboard, which catches the common case but not every case.
    /// Returns the existing spelling, or nil if the name is free.
    static func existingNameFolding(to name: String) async -> String? {
        // Preferred: ask the server, which can see every account.
        if let request = try? request(path: "rest/v1/rpc/account_name_taken",
                                      method: "POST", body: ["p_name": name]),
           let (data, response) = try? await send(request, attempts: 2),
           let http = response as? HTTPURLResponse, http.statusCode == 200 {
            let answer = (String(data: data, encoding: .utf8) ?? "")
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"\n "))
            if answer == "null" || answer.isEmpty { return nil }
            return answer
        }

        // Fallback: the leaderboard only shows players who already have a score.
        let folded = await namesFolding(to: name)
        return folded.first { $0.lowercased() == name.lowercased() && $0 != name }
    }

    // MARK: - Scores

    @discardableResult
    static func postScore(name: String, password: String, score: Int) async -> Bool {
        guard score > 0 else { return false }
        do {
            let request = try request(path: "rest/v1/rpc/post_score", method: "POST", body: [
                "p_name": name, "p_password": password,
                "p_game": gameID, "p_score": score, "p_guest": false,
            ])
            let (data, response) = try await send(request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return false }
            return (String(data: data, encoding: .utf8) ?? "").contains("true")
        } catch {
            return false
        }
    }

    /// Apple requires an in-app account deletion path (Guideline 5.1.1(v)).
    /// This calls `account_delete`, which does NOT yet exist on the backend —
    /// see README for the SQL that needs adding to Supabase.
    static func deleteAccount(name: String, password: String) async -> Bool {
        do {
            let request = try request(path: "rest/v1/rpc/account_delete", method: "POST", body: [
                "p_name": name, "p_password": password,
            ])
            let (data, response) = try await send(request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return false }
            let answer = (String(data: data, encoding: .utf8) ?? "")
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"\n "))
            return answer == "true" || answer == "ok"
        } catch {
            return false
        }
    }

    static func leaderboard(limit: Int = 100) async throws -> [Entry] {
        var components = URLComponents(url: url.appendingPathComponent("rest/v1/leaderboard"),
                                       resolvingAgainstBaseURL: false)!
        components.queryItems = [
            .init(name: "select", value: "name,game,score,is_guest"),
            .init(name: "game", value: "eq.\(gameID)"),
            .init(name: "order", value: "score.desc"),
            .init(name: "limit", value: String(limit)),
        ]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 20
        request.setValue(key, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await send(request)
        let rows = try JSONDecoder().decode([Entry].self, from: data)

        // The scores table is keyed on (name, game, is_guest), so a player who
        // played as a guest and then signed in has two rows and appears twice.
        // Keep only their best. Names are case-sensitive server-side, so fold
        // case here too, otherwise "Ilan" and "ilan" still show as two people.
        var bestByPlayer: [String: Entry] = [:]
        for row in rows {
            let key = row.name.lowercased()
            if let existing = bestByPlayer[key], existing.score >= row.score { continue }
            bestByPlayer[key] = row
        }
        return bestByPlayer.values.sorted {
            $0.score != $1.score ? $0.score > $1.score
                                 : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    private static func friendly(_ error: Error) -> String {
        let code = (error as? URLError)?.code
        // Only claim "offline" when iOS is certain of it — and only after the
        // retries above have all failed.
        if code == .notConnectedToInternet {
            return "You appear to be offline. The game still works without an account."
        }
        if code == .timedOut { return "The server took too long to answer. Please try again." }
        return "Couldn't reach the server. Please try again in a moment."
    }
}

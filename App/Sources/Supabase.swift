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
            let (data, response) = try await URLSession.shared.data(for: request)
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

    // MARK: - Scores

    @discardableResult
    static func postScore(name: String, password: String, score: Int) async -> Bool {
        guard score > 0 else { return false }
        do {
            let request = try request(path: "rest/v1/rpc/post_score", method: "POST", body: [
                "p_name": name, "p_password": password,
                "p_game": gameID, "p_score": score, "p_guest": false,
            ])
            let (data, response) = try await URLSession.shared.data(for: request)
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
            let (data, response) = try await URLSession.shared.data(for: request)
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
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode([Entry].self, from: data)
    }

    private static func friendly(_ error: Error) -> String {
        let code = (error as? URLError)?.code
        if code == .notConnectedToInternet || code == .networkConnectionLost {
            return "You're offline — scores will sync next time you play online."
        }
        if code == .timedOut { return "The server took too long to answer. Try again." }
        return "Couldn't reach the server."
    }
}

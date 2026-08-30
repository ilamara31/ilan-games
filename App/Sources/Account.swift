import Foundation
import Security

/// The signed-in player. The username is ordinary preference data, but the
/// password has to be kept because `post_score` re-authenticates on every submit —
/// so it lives in the Keychain, never in UserDefaults.
enum Account {

    private static let nameKey = "stackTower.accountName"
    private static let service = "com.ilangames.stacktower.account"

    static var name: String? {
        get { UserDefaults.standard.string(forKey: nameKey) }
        set { UserDefaults.standard.set(newValue, forKey: nameKey) }
    }

    static var isSignedIn: Bool { name != nil && password != nil }

    static var password: String? {
        guard let name else { return nil }
        return keychainRead(account: name)
    }

    static func signIn(name: String, password: String) {
        self.name = name
        keychainWrite(account: name, password: password)
    }

    static func signOut() {
        if let name { keychainDelete(account: name) }
        self.name = nil
    }

    /// Posts the score if someone is signed in; silently does nothing otherwise.
    static func submit(score: Int) async {
        guard let name, let password else { return }
        await Supabase.postScore(name: name, password: password, score: score)
    }

    // MARK: - Validation, mirroring the website's rules

    static func validationError(name: String, password: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return "Enter a username." }
        if trimmed.count < 3 { return "Username must be at least 3 characters." }
        if trimmed.count > 16 { return "Username must be 16 characters or less." }
        if trimmed.range(of: "^[A-Za-z0-9 _-]+$", options: .regularExpression) == nil {
            return "Username can only use letters, numbers, spaces, - and _."
        }
        if trimmed.range(of: "[A-Za-z0-9]", options: .regularExpression) == nil {
            return "Username needs at least one letter or number."
        }
        if password.isEmpty { return "Enter a password." }
        if password.count < 4 { return "Password must be at least 4 characters." }
        if password.count > 64 { return "Password must be 64 characters or less." }
        return nil
    }

    // MARK: - Keychain

    private static func query(account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    private static func keychainWrite(account: String, password: String) {
        var attributes = query(account: account)
        SecItemDelete(attributes as CFDictionary)
        attributes[kSecValueData as String] = Data(password.utf8)
        // Readable only on this device, and only once it has been unlocked since boot.
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(attributes as CFDictionary, nil)
    }

    private static func keychainRead(account: String) -> String? {
        var attributes = query(account: account)
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(attributes as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func keychainDelete(account: String) {
        SecItemDelete(query(account: account) as CFDictionary)
    }
}

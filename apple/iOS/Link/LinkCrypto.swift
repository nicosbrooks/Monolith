import Foundation
import CryptoKit
import Security

// End-to-end encryption for linked computers. Must match src/link/crypto.ts byte for byte.
//
// The computer shows a QR code with a fresh P-256 public key and a one-time secret. The phone answers with its own
// public key plus an HMAC of it under the secret (so the relay can't swap keys). Both sides run ECDH and
// HKDF-SHA256(salt = secret, info = "socratic/link/v1") to get an AES-256-GCM key. Frames are iv(12) ‖ ciphertext ‖ tag.

nonisolated enum B64U {
    static func encode(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func decode(_ s: String) -> Data? {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.count % 4 != 0 { t += "=" }
        return Data(base64Encoded: t)
    }
}

nonisolated enum LinkCrypto {
    static let info = Data("socratic/link/v1".utf8)

    /// Our reply to a pairing QR code, and the key both sides will share.
    static func answer(webPub: Data, secret: Data, name: String) throws -> (hello: [String: String], key: Data) {
        let mine = P256.KeyAgreement.PrivateKey()
        let pub = mine.publicKey.x963Representation // 65-byte uncompressed point, same as WebCrypto "raw"
        let shared = try mine.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: webPub))
        let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: secret, sharedInfo: info, outputByteCount: 32)
        let mac = HMAC<SHA256>.authenticationCode(for: pub, using: SymmetricKey(data: secret))
        return (["p": "hello", "k": B64U.encode(pub), "m": B64U.encode(Data(mac)), "n": name], key.withUnsafeBytes { Data($0) })
    }

    static func seal(_ plain: Data, key: SymmetricKey) throws -> String {
        guard let box = try AES.GCM.seal(plain, using: key).combined else { throw CocoaError(.coderInvalidValue) }
        return B64U.encode(box)
    }

    static func open(_ box: String, key: SymmetricKey) throws -> Data {
        guard let d = B64U.decode(box) else { throw CocoaError(.coderReadCorrupt) }
        return try AES.GCM.open(AES.GCM.SealedBox(combined: d), using: key)
    }
}

/// Pairings hold encryption keys, so they live in the Keychain, on this device only.
nonisolated enum LinkKeychain {
    private static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.socratic.link",
        kSecAttrAccount as String: "pairings",
    ]

    static func load() -> Data? {
        var q = base
        q[kSecReturnData as String] = true
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    static func save(_ data: Data) {
        SecItemDelete(base as CFDictionary)
        var q = base
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }
}

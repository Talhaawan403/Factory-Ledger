# Factory Ledger security model

## Cloud ledger

Google Sign-In establishes the Firebase user. Firestore rules isolate ledger records by `request.auth.uid`, validate supported record shapes, reject stale writes, and deny unknown paths. Factory Ledger does not require its own TOTP authenticator.

This deliberately favors usability. If a Google/Firebase account is compromised, an attacker may be able to read, change, or delete that account's cloud ledger. The local App PIN, biometric prompt, Android Phone Lock, and restore confirmation cannot prevent access from another authenticated device.

## This device

The optional five-digit App PIN is a convenience/privacy lock, not database-at-rest encryption. Its PBKDF2 hash and device salt remain local and are not synchronized. Fingerprint or supported biometrics can unlock the app. On Android, Phone Lock can authorize a forgotten-PIN reset; Factory Ledger receives only success or failure and never sees the phone PIN, pattern, password, fingerprint, or face data.

Factory Ledger has no separate recovery code or master key. Upgraded installations remove the retired recovery-code local-storage entries without changing the App PIN or ledger.

## Restore and destructive actions

The fresh-device restore confirmation reduces accidental downloads on a shared browser or device. It is not an independent authorization factor. Account-switch warnings, local/cloud conflict choices, fail-closed cloud wipe verification, soft deletion, stale-write protection, and JSON backup guidance remain in place.

## Operational boundary

Repository tests prove local source behavior only. Production claims additionally require deployment of the matching Firestore rules, removal of old Factory Ledger TOTP factors, confirmation that ordinary Google sign-in works, and owner-operated Android and two-device validation.

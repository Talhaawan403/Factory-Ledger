# Legacy authenticator removal checklist

This file is retained at its old path so existing operational links do not silently become misleading. Factory Ledger no longer enrolls new TOTP factors or requires an app-specific second factor for synchronization.

## Safe migration order

1. Export and verify a current JSON backup for each pilot account.
2. Confirm which live Firebase project is in use and whether its deployed Firestore rules require `firebase.sign_in_second_factor`.
3. Deploy the tested owner-only rules from this repository before removing any enrolled factor.
4. Give each already-enrolled user the transition build. The user completes the existing authenticator challenge one last time; the app then removes only the factor named `Factory Ledger authenticator`.
5. Verify each target Firebase user has zero remaining Factory Ledger factors and can sign in again with Google alone.
6. Only then disable TOTP in Identity Platform and ship a later cleanup release that deletes the temporary sign-in resolver.

If a user has lost the authenticator, an authorized administrator must verify the account owner and remove the factor through Firebase administration. Never place Admin SDK credentials or service-account keys in the client app or repository.

## Required validation

- An authenticated owner can read and write only their own ledger.
- A different UID and an unauthenticated request remain denied.
- Existing cloud records download only after the restore confirmation.
- Account switching, offline changes, conflict handling, cloud wipe failure handling, and two-device synchronization still work.
- Android Phone Lock can reset a forgotten local App PIN; cancellation keeps the app locked.

The repository change does not deploy rules, remove live factors, disable Identity Platform TOTP, or prove real-device behavior. Record those operational results separately. The current security boundary is documented in `docs/SECURITY_MODEL.md`.

# Otâcimow runbook

All commands run from the repository root in Termux. Node 20+ is required (`pkg install nodejs`).

## One-time: create the license key pair

    node tools/otacimow-license.mjs keygen

- Private key: `~/.otacimow/license_private.pem` (mode 600). Never printed, never committed. Back it up offline
  (an encrypted copy off the phone). If it is lost, no new licenses can be issued, and the app must be rebuilt with a new public key.
- Public key: `android/app/src/main/assets/license_pub.pem`. Commit it. CI fails without it.
- `keygen` refuses to overwrite an existing private key.

## Issue a license (manual, until RaPaX issues them)

    node tools/otacimow-license.mjs issue --new --days 30      # time-limited (tester)
    node tools/otacimow-license.mjs issue --new                # no expiry (customer)

The token prints once and is appended (without the token) to `~/.otacimow/issued.tsv` with the transaction ID.
Send the token to the buyer. The buyer opens Otâcimow, taps LICENSE, pastes it, and accepts the terms.

Check any token:

    node tools/otacimow-license.mjs verify-token PASTE_TOKEN_HERE

## Verify a file

    node tools/otacimow-license.mjs verify-seal /path/to/file.mp4

Or in the app: Home, VERIFY A SEALED FILE.

## Key rotation

A new public key means a new build. Existing licenses signed by the old key stop working in the new build.
Plan: keep the old key until all customers update, or issue replacement tokens. Document the date in `~/.otacimow/issued.tsv` notes.

## Release checklist

1. `docs/SEAL_SPEC.md` and README status table match what is actually shipped.
2. CI green on `main` (type-check, Jest, tool self-test, Kotlin unit tests, build).
3. Device smoke test passed on a physical phone: import, studio import, sync, export (reverb on/off, loudness), seal, verify, MediaStore save, each share target.
4. Release keystore created and backed up; `com.otacimow` signed with it. (BLOCKED: operator.)
5. SHA-256 of the release APK published next to the download.
6. Terms reviewed by counsel; `TERMS_VERSION` in `src/lib/terms.ts` bumped to the approved version.
7. FFmpegKit LGPL obligations satisfied (source offer, notice screen).
8. Marketing claims limited to what is implemented (see README status table).

## Support

Replacement: if a license does not work, issue a new token for the same `tid` or a new one and note it in `issued.tsv`.
Never ask the buyer to send a private key (they have none) or any account credentials.

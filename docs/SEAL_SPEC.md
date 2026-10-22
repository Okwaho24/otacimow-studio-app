# Otâcimow seal and license format, version 1

## License token

    OTC1.<base64url(payload)>.<base64url(signature)>

- `payload`: UTF-8 lines `key=value`, in this order when issued: `v=1`, `tid`, `sku=otacimow`, `iat`, optional `exp`.
  Times are ISO-8601 UTC (`2026-10-21T12:00:00Z`). Keys match `^[a-z][a-z0-9_]{0,15}$`; values match
  `^[A-Za-z0-9._:+-]{1,2048}$`. Duplicate keys and unknown encodings are rejected.
- `signature`: ECDSA P-256 over the exact payload bytes, SHA-256, DER encoded.
- The token carries a transaction ID (`tid`), not a name or email.
- Check: signature under the public key bundled with the app (`assets/license_pub.pem`), `v=1`, `sku=otacimow`,
  `iat <= now + 1 day`, and `exp >= now` if present. Maximum length 2048 characters.
- ECDSA P-256 is used because Ed25519 is not available on Android below API 33.

## MP4 seal

One top-level `free` box appended after the last box of the file:

    size(4) 'free' | 'OTCSEAL1'(8) | payloadLength(4, big-endian) | payload

Payload lines: `v=1`, `sha256=<hex of every byte before this box>`, `ts=<export time, UTC>`, `tok=<license token>`.

Sealing appends only. It refuses a file that is already sealed, and a file whose last box extends to end of file.
It never rewrites existing bytes. A failed write is rolled back by truncating to the original length.

### Verification results

| Status | Meaning |
|---|---|
| VALID | Box structure is sound, the seal is the last box, the license signature is valid for the seal time, and the SHA-256 of the preceding bytes matches. |
| NO_SEAL | No seal box. Typical for re-encoded files. |
| TAMPERED_CONTENT | Seal is well-formed but the preceding bytes changed. |
| TAMPERED_TRAILING | Data exists after the seal. |
| BAD_LICENSE | Embedded token is invalid, outside its validity window at the seal time, or for another product. |
| MALFORMED_SEAL | Seal box present but unreadable, duplicated, or oversized. |
| MALFORMED_FILE | MP4 box structure is broken or truncated. |
| NOT_MP4 | Does not start with an `ftyp` box. |

### Limits (read before making any claim)

1. Re-encoding, trimming, remuxing or uploading to a platform removes the seal. The claim is scoped to the original master file.
2. VALID proves integrity and that the token was signed by Archer Chain Analytics. It does not prove who recorded the video or when. The `ts` value is written by the device and is not independently trusted.
3. The token identifies a license, not a person. Whoever holds the token can use it. Leaked tokens can be listed for revocation only if the app is updated to carry a revocation list (NOT IMPLEMENTED).
4. Anyone can verify with the public key. Nobody without the private key can mint a token.
5. Authorship evidence requires a registry timestamp (ROADMAP: hash-only registry on RaPaX, public verify page).

## Behaviour on invalid license

The app refuses to activate or export. It shows a message. It does not delete, modify or lock any project, media
or previously exported file.

## Versioning

Any change to the token or seal layout increments `v`. Verifiers reject unknown versions.

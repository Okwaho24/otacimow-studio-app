# Otâcimow™

Record or import a performance video, lock a studio track to it, process the audio (EQ, compressor, reverb,
gain) and export a vertical clip. Every export is sealed with the buyer's license token so the original file can
be verified later. Android only. Sold by APK download. Not distributed through Google Play.

© Archer Chain Analytics. Otâcimow and AcerbE are trademarks of Archer Chain Analytics.

## Status

| Area | Status |
|---|---|
| Record, import, studio sync ("Waveform Lock"), EQ / comp / reverb / gain, FFmpeg export | Implemented. Device smoke test PENDING. |
| License token (signed, offline check) | Implemented. Unit tested (JVM + Node, byte-compatible). |
| MP4 seal on export, verify screen, recent exports | Implemented. Seal core unit tested. Android glue (`SealModule`) compiles only in CI and is NOT yet tested on a device. |
| Save to `Movies/Otacimow` via MediaStore | Implemented, UNTESTED on device. |
| One-tap share to Instagram / TikTok / Facebook / X / system sheet | Implemented, UNTESTED on device. User taps Post in the target app. |
| In-app connectors (post directly from Otâcimow) | ROADMAP. Needs Meta and TikTok app approval. X API is paid. |
| Hash-only registry and public verify page | ROADMAP. Needs RaPaX endpoint. |
| RaPaX `license` product type (token issued at purchase) | NOT IMPLEMENTED. Tokens are issued by hand with `tools/otacimow-license.mjs`. |
| Audio-domain watermark that survives re-encoding | ROADMAP (research). Not claimed anywhere. |
| Release signing key | BLOCKED on the operator. Release builds are still signed with the debug key. |
| Terms of the license | DRAFT. AI-generated. Counsel review required before sale. |

## What the seal proves, and what it does not

See `docs/SEAL_SPEC.md`. In one paragraph: the seal proves that the bytes of an exported MP4 are unchanged since
export and that it carries a license token signed by Archer Chain Analytics. It does not survive re-encoding
(social platforms, trimming, transcoding), so a posted copy has no seal. It does not by itself prove who made the
video or when; for that you need a timestamped registry entry (ROADMAP).

## Build

Requirements: Node 20, JDK 17, Android SDK. CI does all of this on every push to `main` and on manual dispatch.

    npm ci
    npx tsc --noEmit
    npx jest
    node tools/selftest.mjs
    cd android && ./gradlew :app:testDebugUnitTest assembleDebug

The build fails if `android/app/src/main/assets/license_pub.pem` is missing. See `docs/RUNBOOK.md`.

## Operate and sell

`docs/RUNBOOK.md` covers key generation, issuing licenses, activating on a phone, verifying a file, rotating the
key, and the release checklist.

## Layout

    src/                       React Native UI (screens, lib/seal.ts wrapper)
    android/app/src/main/java/com/otacimow/audio   native audio engine, sync, waveform
    android/app/src/main/java/com/otacimow/seal    License.kt, Mp4Seal.kt, SealModule.kt
    android/app/src/test/                          JVM tests and test vectors
    tools/                                         operator CLI, reference implementation, self-test
    docs/                                          seal spec, runbook

## Third-party software

FFmpeg (via FFmpegKit) is used under the LGPL. See `THIRD_PARTY_NOTICES.md`. Distribution obligations for the
bundled FFmpegKit build (source offer and in-app notice) are OPEN: confirm the provenance of the local AAR before
selling.

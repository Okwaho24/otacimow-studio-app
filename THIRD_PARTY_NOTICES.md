# Third-party notices — Otâcimow™

DRAFT. Verify each statement against the actual build before any public release.

## FFmpegKit / FFmpeg (LGPL build, arm64-v8a)

- Component: `com.arthenica:ffmpeg-kit-min` 6.0-2, committed as a local AAR in
  `android/local-maven/`.
- Upstream: https://github.com/arthenica/ffmpeg-kit (v6.0), which bundles FFmpeg.
- Build: LGPL configuration with Android MediaCodec, no GPL components, no x264.
  Build scripts: https://github.com/Okwaho24/ffmpeg-kit-lgpl-build
- License: GNU Lesser General Public License. The FFmpeg libraries ship as separate
  shared objects (`libavcodec.so`, `libavfilter.so`, and others) inside the APK, so they
  can be replaced with a modified build.
- Corresponding source and the exact build configuration must be published and kept
  available for every binary distributed to testers or customers.

OPEN ITEMS before distributing beyond internal testing:
1. Confirm the AAR was produced by the workflow in `ffmpeg-kit-lgpl-build`
   (record its commit SHA and the FFmpeg `configure` flags here).
2. Replace the `ffmpeg-kit-lgpl-build` README, which currently describes RaPaX, with
   the real build instructions.
3. Show an LGPL attribution screen inside the app.

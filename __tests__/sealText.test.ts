import { shortHash, verifyText, licenseReasonText, sealErrorText } from "../src/lib/sealText";

describe("sealText", () => {
  it("shortens a sha256", () => {
    const h = "a".repeat(32) + "b".repeat(32);
    expect(shortHash(h)).toBe("aaaaaaaa…bbbbbbbb");
    expect(shortHash("abc")).toBe("abc");
    expect(shortHash(undefined)).toBe("");
  });

  it("marks only VALID as ok", () => {
    expect(verifyText("VALID").ok).toBe(true);
    for (const s of ["NO_SEAL", "TAMPERED_CONTENT", "TAMPERED_TRAILING", "BAD_LICENSE",
      "MALFORMED_SEAL", "MALFORMED_FILE", "NOT_MP4", "SOMETHING_NEW"]) {
      expect(verifyText(s).ok).toBe(false);
    }
  });

  it("says NO SEAL, not tampered, for a missing seal", () => {
    expect(verifyText("NO_SEAL").text).toMatch(/NO SEAL/);
    expect(verifyText("NO_SEAL").text).not.toMatch(/TAMPER/);
  });

  it("includes the license error for BAD_LICENSE", () => {
    expect(verifyText("BAD_LICENSE", "EXPIRED").text).toMatch(/EXPIRED/);
  });

  it("maps license reasons and falls back safely", () => {
    expect(licenseReasonText("EXPIRED")).toMatch(/expired/);
    expect(licenseReasonText("ZZZ")).toMatch(/ZZZ/);
  });

  it("maps native error codes", () => {
    expect(sealErrorText({ code: "not_licensed" })).toMatch(/Activate/);
    expect(sealErrorText({ code: "terms_not_accepted" })).toMatch(/terms/);
    expect(sealErrorText({ code: "not_installed" })).toMatch(/not installed/);
    expect(sealErrorText({ code: "license_invalid", message: "BAD_SIGNATURE" })).toMatch(/signature/);
    expect(sealErrorText(new Error("boom"))).toBe("boom");
  });
});

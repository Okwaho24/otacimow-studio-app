// Plain-language text for seal, license and share results. Pure functions (unit tested).
export type VerifyStatus =
  | "VALID" | "NO_SEAL" | "TAMPERED_CONTENT" | "TAMPERED_TRAILING"
  | "BAD_LICENSE" | "MALFORMED_SEAL" | "MALFORMED_FILE" | "NOT_MP4";

export const shortHash = (h: string | undefined | null): string =>
  h && h.length >= 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : h ?? "";

export function verifyText(status: string, licenseError?: string): { ok: boolean; text: string } {
  switch (status as VerifyStatus) {
    case "VALID":
      return { ok: true, text: "SEAL VALID — the file is exactly as it was sealed." };
    case "NO_SEAL":
      return { ok: false, text: "NO SEAL — this file carries no Otâcimow seal (it may have been re-encoded)." };
    case "TAMPERED_CONTENT":
      return { ok: false, text: "TAMPERED — the video no longer matches its seal." };
    case "TAMPERED_TRAILING":
      return { ok: false, text: "TAMPERED — data was added after the seal." };
    case "BAD_LICENSE":
      return { ok: false, text: `LICENSE NOT VALID IN SEAL${licenseError ? ` (${licenseError})` : ""}.` };
    case "MALFORMED_SEAL":
      return { ok: false, text: "SEAL DAMAGED — the seal data cannot be read." };
    case "MALFORMED_FILE":
      return { ok: false, text: "FILE DAMAGED — the MP4 structure is broken or truncated." };
    case "NOT_MP4":
      return { ok: false, text: "NOT AN MP4 FILE." };
    default:
      return { ok: false, text: `UNKNOWN RESULT (${status}).` };
  }
}

export function licenseReasonText(reason?: string): string {
  switch (reason) {
    case "MALFORMED": return "That is not a valid license.";
    case "BAD_SIGNATURE": return "License signature is not valid for this app.";
    case "EXPIRED": return "This license has expired.";
    case "NOT_YET_VALID": return "This license is not valid yet. Check your phone's date and time.";
    case "WRONG_SKU": return "This license is for a different product.";
    case "UNSUPPORTED_VERSION": return "This license needs a newer version of the app.";
    default: return `License rejected${reason ? ` (${reason})` : ""}.`;
  }
}

export function sealErrorText(e: unknown): string {
  const err = e as { code?: string; message?: string } | undefined;
  switch (err?.code) {
    case "not_licensed": return "Activate a valid license to export.";
    case "terms_not_accepted": return "Accept the license terms to export.";
    case "no_key": return "This build has no license key, so it cannot export.";
    case "license_invalid": return licenseReasonText(err?.message);
    case "seal_failed": return `Could not seal the video (${err?.message ?? "unknown"}).`;
    case "seal_verify_failed": return `The seal did not verify (${err?.message ?? "unknown"}). Nothing was saved.`;
    case "save_failed": return `Could not save the sealed video (${err?.message ?? "unknown"}).`;
    case "no_file": return "The exported file is missing.";
    case "not_installed": return "That app is not installed.";
    default: return err?.message ?? String(e);
  }
}

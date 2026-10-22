import { NativeModules } from "react-native";
import { TERMS_VERSION } from "./terms";
import type { VerifyStatus } from "./sealText";

const { Seal } = NativeModules;

export type LicenseState = "no_key" | "none" | "invalid" | "valid";

export interface LicenseStatus {
  state: LicenseState;
  reason?: string;
  tid?: string;
  exp?: string;
  accepted: boolean;
}

export interface ExportResult {
  sha256: string;
  tid: string;
  ts: string;
  uri: string;
  location: string;
}

export interface VerifyResult {
  status: VerifyStatus;
  tid?: string;
  ts?: string;
  sha256?: string;
  licenseError?: string;
}

export interface RecentExport {
  ts: string;
  name: string;
  sha256: string;
  tid: string;
  uri: string;
}

export const SHARE_TARGETS = [
  { label: "Instagram", pkg: "com.instagram.android" },
  { label: "TikTok", pkg: "com.zhiliaoapp.musically" },
  { label: "Facebook", pkg: "com.facebook.katana" },
  { label: "X", pkg: "com.twitter.android" },
] as const;

function native(): any {
  if (!Seal) throw Object.assign(new Error("Seal module is missing from this build."), { code: "no_module" });
  return Seal;
}

export const SealApi = {
  status: async (): Promise<LicenseStatus> => native().licenseStatus(TERMS_VERSION),
  activate: async (token: string): Promise<LicenseStatus> => native().activateLicense(token.trim(), TERMS_VERSION),
  accept: async (): Promise<LicenseStatus> => native().acceptTerms(TERMS_VERSION),
  /** Seals, verifies, saves to Movies/Otacimow and records the export. */
  finalizeExport: async (path: string, displayName: string): Promise<ExportResult> =>
    native().finalizeExport(path, displayName, TERMS_VERSION),
  verify: async (path: string): Promise<VerifyResult> => native().verifyFile(path),
  /** pkg = null opens the system share sheet. The user taps Post in the target app. */
  share: async (uri: string, pkg: string | null, sha256: string | null): Promise<boolean> =>
    native().shareVideo(uri, pkg, sha256),
  recent: async (limit = 20): Promise<RecentExport[]> => native().recentExports(limit),
};

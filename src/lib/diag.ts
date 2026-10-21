/**
 * Zero-telemetry diagnostics — JS wrapper.
 * Call from a "Export diagnostics" button in Settings/feedback UI.
 * Resolves with the local path of the generated zip; share via the OS
 * share sheet so the tester chooses where (or whether) it goes.
 */
import { NativeModules, Share } from "react-native";

const { Diag } = NativeModules;

export async function exportDiagnostics(): Promise<string> {
  return Diag.exportDiagnostics();
}

export async function exportAndShareDiagnostics(): Promise<void> {
  const path = await exportDiagnostics();
  await Share.share({
    title: "Otacimow beta diagnostics",
    message: `Otacimow diagnostic archive (generated locally, nothing auto-sent): file://${path}`,
    url: `file://${path}`,
  });
}

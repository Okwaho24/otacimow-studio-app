import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { pick, types } from "react-native-document-picker";
import RNFS from "react-native-fs";
import { SealApi, LicenseStatus } from "../lib/seal";
import { TERMS_PARAGRAPHS, TERMS_VERSION } from "../lib/terms";
import { licenseReasonText, sealErrorText } from "../lib/sealText";
import { T } from "../lib/theme";

interface Props {
  onBack: (status: LicenseStatus | null) => void;
}

export default function LicenseScreen({ onBack }: Props) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setStatus(await SealApi.status()); }
    catch (e) { setError(sealErrorText(e)); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const activate = async (t: string) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await SealApi.activate(t));
      setToken("");
    } catch (e) {
      setError(sealErrorText(e));
    }
    setBusy(false);
  };

  const importFile = async () => {
    setError(null);
    let dest: string | null = null;
    try {
      const [res] = await pick({ type: [types.allFiles] });
      if (!res?.uri) return;
      dest = `${RNFS.CachesDirectoryPath}/license_${Date.now()}.tmp`;
      await RNFS.copyFile(res.uri, dest);
      const text = (await RNFS.readFile(dest, "utf8")).trim();
      await activate(text);
    } catch (e) {
      setError(sealErrorText(e));
    } finally {
      if (dest) { try { await RNFS.unlink(dest); } catch {} }
    }
  };

  const accept = async () => {
    setBusy(true);
    setError(null);
    try { setStatus(await SealApi.accept()); }
    catch (e) { setError(sealErrorText(e)); }
    setBusy(false);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      <Text style={styles.kicker}>LICENSE</Text>

      {!status && <ActivityIndicator color={T.accent} />}

      {status?.state === "no_key" && (
        <Text style={styles.warn}>
          This build has no license key, so it cannot activate a license or export sealed video.
        </Text>
      )}

      {status?.state === "invalid" && (
        <Text style={styles.warn}>The stored license is not valid. {licenseReasonText(status.reason)}</Text>
      )}

      {(status?.state === "none" || status?.state === "invalid") && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.label}>PASTE YOUR LICENSE</Text>
          <TextInput
            style={styles.input} value={token} onChangeText={setToken}
            placeholder="OTC1.…" placeholderTextColor={T.dim}
            multiline autoCapitalize="none" autoCorrect={false} editable={!busy} />
          <Btn label="Activate" primary disabled={busy || token.trim().length === 0} onPress={() => activate(token)} />
          <View style={{ height: 8 }} />
          <Btn label="Import license file" disabled={busy} onPress={importFile} />
        </View>
      )}

      {status?.state === "valid" && !status.accepted && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.label}>LICENSE TERMS · {TERMS_VERSION}</Text>
          {TERMS_PARAGRAPHS.map(p => (
            <View key={p.title} style={{ marginBottom: 12 }}>
              <Text style={styles.termTitle}>{p.title.toUpperCase()}</Text>
              <Text style={styles.termBody}>{p.body}</Text>
            </View>
          ))}
          <Btn label="I accept these terms" primary disabled={busy} onPress={accept} />
        </View>
      )}

      {status?.state === "valid" && status.accepted && (
        <View style={{ marginTop: 12 }}>
          <Text style={[styles.ok]}>✓ LICENSE ACTIVE</Text>
          <Text style={styles.mono}>ID  {status.tid}</Text>
          {status.exp ? <Text style={styles.mono}>EXPIRES  {status.exp}</Text> : null}
          <Text style={styles.mono}>TERMS  {TERMS_VERSION} accepted</Text>
        </View>
      )}

      {error && <Text style={[styles.warn, { marginTop: 14 }]}>{error}</Text>}

      <View style={{ marginTop: 28 }}>
        <Btn label="Back" onPress={() => onBack(status)} />
      </View>
    </ScrollView>
  );
}

function Btn({ label, primary, disabled, onPress }: {
  label: string; primary?: boolean; disabled?: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled}
      style={[styles.btn, primary && styles.btnPrimary, disabled && { opacity: 0.4 }]}>
      <Text style={[styles.btnText, primary && { color: "#141414" }]}>{label.toUpperCase()}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  kicker: { color: T.accent, fontSize: 10, letterSpacing: 3, fontFamily: "monospace", marginBottom: 8 },
  label: { color: T.dim, fontSize: 10, letterSpacing: 2, fontFamily: "monospace", marginBottom: 8 },
  input: {
    minHeight: 96, borderWidth: 1, borderColor: T.line, borderRadius: 4, color: T.text,
    padding: 10, fontFamily: "monospace", fontSize: 11, marginBottom: 10, textAlignVertical: "top",
  },
  warn: { color: T.rec, fontSize: 12, lineHeight: 18 },
  ok: { color: T.ok, fontSize: 13, fontFamily: "monospace", letterSpacing: 1.2, marginBottom: 8 },
  mono: { color: T.text, fontSize: 11, fontFamily: "monospace", marginTop: 4 },
  termTitle: { color: T.accent, fontSize: 10, letterSpacing: 2, fontFamily: "monospace", marginBottom: 3 },
  termBody: { color: T.text, fontSize: 13, lineHeight: 19 },
  btn: { paddingVertical: 13, borderWidth: 1, borderColor: T.line, borderRadius: 4, alignItems: "center" },
  btnPrimary: { backgroundColor: T.accent, borderColor: T.accent },
  btnText: { color: T.text, fontSize: 11, letterSpacing: 1.4, fontFamily: "monospace" },
});

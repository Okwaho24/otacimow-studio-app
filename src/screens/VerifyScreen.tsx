import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { pick, types } from "react-native-document-picker";
import RNFS from "react-native-fs";
import { SealApi, RecentExport, VerifyResult } from "../lib/seal";
import { shortHash, verifyText, sealErrorText } from "../lib/sealText";
import { T } from "../lib/theme";

export default function VerifyScreen({ onBack }: { onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentExport[]>([]);

  useEffect(() => {
    SealApi.recent(20).then(setRecent).catch(() => setRecent([]));
  }, []);

  const verify = async () => {
    setError(null);
    setResult(null);
    let dest: string | null = null;
    try {
      const [res] = await pick({ type: [types.video] });
      if (!res?.uri) return;
      setBusy(true);
      setName(res.name ?? "file");
      dest = `${RNFS.CachesDirectoryPath}/verify_${Date.now()}.mp4`;
      await RNFS.copyFile(res.uri, dest);
      setResult(await SealApi.verify(dest));
    } catch (e) {
      setError(sealErrorText(e));
    } finally {
      if (dest) { try { await RNFS.unlink(dest); } catch {} }
      setBusy(false);
    }
  };

  const text = result ? verifyText(result.status, result.licenseError) : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      <Text style={styles.kicker}>VERIFY A FILE</Text>
      <Text style={styles.note}>
        Checks that an MP4 still carries an intact Otâcimow seal. Posted copies from social platforms are
        re-encoded and will report NO SEAL. Verify your saved master.
      </Text>
      <TouchableOpacity style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.4 }]} onPress={verify} disabled={busy}>
        <Text style={[styles.btnText, { color: "#141414" }]}>{busy ? "CHECKING…" : "CHOOSE A VIDEO"}</Text>
      </TouchableOpacity>

      {text && result && (
        <View style={styles.card}>
          <Text style={[styles.status, { color: text.ok ? T.ok : T.rec }]}>{text.text}</Text>
          <Text style={styles.mono}>{name}</Text>
          {result.tid ? <Text style={styles.mono}>LICENSE ID  {result.tid}</Text> : null}
          {result.ts ? <Text style={styles.mono}>SEALED  {result.ts}</Text> : null}
          {result.sha256 ? <Text style={styles.mono}>SHA-256  {shortHash(result.sha256)}</Text> : null}
        </View>
      )}
      {error && <Text style={[styles.status, { color: T.rec, marginTop: 14 }]}>{error}</Text>}

      <Text style={[styles.kicker, { marginTop: 28 }]}>RECENT EXPORTS</Text>
      {recent.length === 0 && <Text style={styles.note}>No exports yet.</Text>}
      {recent.map(r => (
        <View key={r.sha256 + r.ts} style={styles.row}>
          <Text style={styles.mono}>{r.name}</Text>
          <Text style={styles.dim}>{r.ts} · {shortHash(r.sha256)}</Text>
        </View>
      ))}

      <View style={{ marginTop: 28 }}>
        <TouchableOpacity style={styles.btn} onPress={onBack}>
          <Text style={styles.btnText}>BACK</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  kicker: { color: T.accent, fontSize: 10, letterSpacing: 3, fontFamily: "monospace", marginBottom: 8 },
  note: { color: T.dim, fontSize: 12, lineHeight: 18, marginBottom: 14 },
  card: { marginTop: 16, padding: 14, backgroundColor: T.panel, borderWidth: 1, borderColor: T.line, borderRadius: 6 },
  status: { fontSize: 12, fontFamily: "monospace", letterSpacing: 0.6, lineHeight: 18, marginBottom: 8 },
  mono: { color: T.text, fontSize: 11, fontFamily: "monospace", marginTop: 3 },
  dim: { color: T.dim, fontSize: 10, fontFamily: "monospace", marginTop: 2 },
  row: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: T.line },
  btn: { paddingVertical: 13, borderWidth: 1, borderColor: T.line, borderRadius: 4, alignItems: "center" },
  btnPrimary: { backgroundColor: T.accent, borderColor: T.accent },
  btnText: { color: T.text, fontSize: 11, letterSpacing: 1.4, fontFamily: "monospace" },
});

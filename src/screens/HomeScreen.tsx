import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { pick, types } from "react-native-document-picker";
import RNFS from "react-native-fs";
import { SealApi, LicenseStatus } from "../lib/seal";
import { T } from "../lib/theme";

interface Props {
  onRecord: () => void;
  onImported: (path: string, hasVideo: boolean) => void;
  onLicense: () => void;
  onVerify: () => void;
}

export default function HomeScreen({ onRecord, onImported, onLicense, onVerify }: Props) {
  const [lic, setLic] = useState<LicenseStatus | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  useEffect(() => { SealApi.status().then(setLic).catch(() => setLic(null)); }, []);
  const active = lic?.state === "valid" && lic.accepted;

  const doImport = async () => {
    setImportError(null);
    try {
      const [res] = await pick({ type: [types.video, types.audio] });
      if (!res?.uri) return;
      const isVideo = (res.type ?? "").startsWith("video");
      const dest = `${RNFS.CachesDirectoryPath}/import_${Date.now()}`;
      await RNFS.copyFile(res.uri, dest);
      onImported(dest, isVideo);
    } catch (e) {
      setImportError(`Import failed: ${(e as Error)?.message ?? String(e)}`);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.kicker}>YOUR MUSIC IS THE CONTENT</Text>
      <Text style={styles.h1}>Shoot the take.{"\n"}Lock the studio track.{"\n"}Post it loud.</Text>
      <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onRecord}>
        <Text style={[styles.btnText, { color: "#141414" }]}>● RECORD A TAKE</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btn} onPress={doImport}>
        <Text style={styles.btnText}>IMPORT VIDEO / AUDIO</Text>
      </TouchableOpacity>
      {importError && <Text style={styles.err}>{importError}</Text>}
      <TouchableOpacity style={styles.btn} onPress={onVerify}>
        <Text style={styles.btnText}>VERIFY A SEALED FILE</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.lic} onPress={onLicense}>
        <Text style={[styles.licText, { color: active ? T.ok : T.accent }]}>
          {lic === null ? "LICENSE · …"
            : active ? `LICENSE ACTIVE · ${lic.tid}`
            : lic.state === "valid" ? "LICENSE · ACCEPT TERMS TO EXPORT"
            : lic.state === "no_key" ? "LICENSE · NO KEY IN THIS BUILD"
            : "LICENSE · ACTIVATE TO EXPORT"}
        </Text>
      </TouchableOpacity>
      <Text style={styles.foot}>
        CHAIN — GAIN → EQ → COMP → REVERB → MASTER{"\n"}EXPORT BAKES PROCESSED AUDIO INTO YOUR CLIP.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg, padding: 20, justifyContent: "center" },
  kicker: { color: T.accent, fontSize: 10, letterSpacing: 3, fontFamily: "monospace", marginBottom: 10 },
  h1: { color: T.text, fontSize: 30, fontWeight: "800", lineHeight: 34, marginBottom: 28 },
  btn: {
    paddingVertical: 14, borderWidth: 1, borderColor: T.line, borderRadius: 4,
    alignItems: "center", marginBottom: 10,
  },
  btnPrimary: { backgroundColor: T.accent, borderColor: T.accent },
  btnText: { color: T.text, fontSize: 11, letterSpacing: 1.4, fontFamily: "monospace" },
  err: { color: T.rec, fontSize: 11, marginBottom: 10 },
  lic: { paddingVertical: 10, alignItems: "center" },
  licText: { fontSize: 10, letterSpacing: 1.6, fontFamily: "monospace" },
  foot: { color: T.dim, fontSize: 10, lineHeight: 18, fontFamily: "monospace", marginTop: 24, letterSpacing: 0.5 },
});

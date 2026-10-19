import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { pick, types } from "react-native-document-picker";
import RNFS from "react-native-fs";
import { T } from "../lib/theme";

interface Props {
  onRecord: () => void;
  onImported: (path: string, hasVideo: boolean) => void;
}

export default function HomeScreen({ onRecord, onImported }: Props) {
  const doImport = async () => {
    const [res] = await pick({ type: [types.video, types.audio] });
    if (!res?.uri) return;
    const isVideo = (res.type ?? "").startsWith("video");
    const dest = `${RNFS.CachesDirectoryPath}/import_${Date.now()}`;
    await RNFS.copyFile(res.uri, dest);
    onImported(dest, isVideo);
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
  foot: { color: T.dim, fontSize: 10, lineHeight: 18, fontFamily: "monospace", marginTop: 24, letterSpacing: 0.5 },
});

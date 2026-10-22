import React, { useState } from "react";
import { SafeAreaView, StatusBar, View, Text, StyleSheet } from "react-native";
import HomeScreen from "./screens/HomeScreen";
import RecordScreen from "./screens/RecordScreen";
import EditorScreen from "./screens/EditorScreen";
import LicenseScreen from "./screens/LicenseScreen";
import VerifyScreen from "./screens/VerifyScreen";
import { T } from "./lib/theme";

type Screen = "home" | "record" | "edit" | "license" | "verify";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(true);
  // Where the license screen returns to (home, or the editor so the project is not lost).
  const [licenseReturn, setLicenseReturn] = useState<Screen>("home");

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <View style={styles.header}>
        <Text style={styles.brand}>OTÂCI<Text style={{ color: T.accent }}>MOW</Text></Text>
        <Text style={styles.tag}>BETA</Text>
      </View>
      {screen === "home" && (
        <HomeScreen
          onRecord={() => setScreen("record")}
          onLicense={() => { setLicenseReturn("home"); setScreen("license"); }}
          onVerify={() => setScreen("verify")}
          onImported={(p, v) => { setMediaPath(p); setHasVideo(v); setScreen("edit"); }} />
      )}
      {screen === "record" && (
        <RecordScreen
          onBack={() => setScreen("home")}
          onRecorded={p => { setMediaPath(p); setHasVideo(true); setScreen("edit"); }} />
      )}
      {mediaPath && (
        <View style={{ flex: 1, display: screen === "edit" ? "flex" : "none" }}>
          <EditorScreen mediaPath={mediaPath} hasVideo={hasVideo}
            onOpenLicense={() => { setLicenseReturn("edit"); setScreen("license"); }}
            onNewProject={() => { setMediaPath(null); setScreen("home"); }} />
        </View>
      )}
      {screen === "license" && <LicenseScreen onBack={() => setScreen(licenseReturn === "edit" && mediaPath ? "edit" : "home")} />}
      {screen === "verify" && <VerifyScreen onBack={() => setScreen("home")} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: T.line,
  },
  brand: { color: T.text, fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
  tag: { color: T.dim, fontSize: 9, letterSpacing: 2, fontFamily: "monospace" },
});

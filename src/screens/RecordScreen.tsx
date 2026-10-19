import React, { useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Camera, useCameraDevice, useCameraPermission, useMicrophonePermission } from "react-native-vision-camera";
import { T } from "../lib/theme";

interface Props {
  onBack: () => void;
  onRecorded: (path: string) => void;
}

export default function RecordScreen({ onBack, onRecorded }: Props) {
  const camera = useRef<Camera>(null);
  const [position, setPosition] = useState<"front" | "back">("front");
  const device = useCameraDevice(position);
  const { hasPermission: camOk, requestPermission: askCam } = useCameraPermission();
  const { hasPermission: micOk, requestPermission: askMic } = useMicrophonePermission();
  const [recording, setRecording] = useState(false);

  React.useEffect(() => {
    if (!camOk) askCam();
    if (!micOk) askMic();
  }, [camOk, micOk]);

  const start = async () => {
    if (!camera.current) return;
    setRecording(true);
    camera.current.startRecording({
      // NOTE (audio quality): if takes sound over-processed on a given device,
      // patch vision-camera's RecordingSession to AudioSource.UNPROCESSED here.
      onRecordingFinished: v => { setRecording(false); onRecorded(v.path); },
      onRecordingError: () => setRecording(false),
    });
  };

  const stop = async () => { await camera.current?.stopRecording(); };

  if (!device || !camOk || !micOk) {
    return (
      <View style={styles.root}>
        <Text style={styles.msg}>CAMERA / MIC PERMISSION REQUIRED</Text>
        <TouchableOpacity style={styles.btn} onPress={onBack}>
          <Text style={styles.btnText}>BACK</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.camWrap}>
        <Camera ref={camera} style={{ flex: 1 }} device={device} isActive
          video audio />
        <Text style={[styles.badge, { color: recording ? T.rec : T.dim }]}>
          {recording ? "● REC" : "READY"}
        </Text>
      </View>
      <View style={styles.rowBtns}>
        <TouchableOpacity style={styles.btn} onPress={onBack} disabled={recording}>
          <Text style={styles.btnText}>BACK</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary, recording && { backgroundColor: T.rec, borderColor: T.rec }]}
          onPress={recording ? stop : start}>
          <Text style={[styles.btnText, { color: "#141414" }]}>{recording ? "STOP" : "RECORD"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} disabled={recording}
          onPress={() => setPosition(p => (p === "front" ? "back" : "front"))}>
          <Text style={styles.btnText}>FLIP</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg, padding: 16 },
  camWrap: { flex: 1, borderRadius: 6, overflow: "hidden", borderWidth: 1, borderColor: T.line },
  badge: {
    position: "absolute", top: 10, left: 10, fontSize: 11, fontFamily: "monospace",
    backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 3,
  },
  rowBtns: { flexDirection: "row", gap: 8, marginTop: 12 },
  btn: {
    flex: 1, paddingVertical: 13, borderWidth: 1, borderColor: T.line, borderRadius: 4, alignItems: "center",
  },
  btnPrimary: { backgroundColor: T.accent, borderColor: T.accent },
  btnText: { color: T.text, fontSize: 11, letterSpacing: 1.4, fontFamily: "monospace" },
  msg: { color: T.dim, fontFamily: "monospace", textAlign: "center", marginBottom: 16, letterSpacing: 1 },
});

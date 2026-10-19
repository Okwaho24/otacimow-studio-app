import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import Video, { VideoRef } from "react-native-video";
import { pick, types } from "react-native-document-picker";
import { FFmpegKit, ReturnCode } from "ffmpeg-kit-react-native";
import RNFS from "react-native-fs";
import { Engine, Sync, EQ_PRESETS, COMP_PRESETS, REVERB_PRESETS } from "../NativeAudioEngine";
import { buildExportCommand } from "../lib/exportCommand";
import { ensureIRs } from "../lib/genIR";
import { waveformPeaks } from "../lib/waveform";
import WaveformView from "../components/WaveformView";
import { Chip, Fader } from "../components/RackControls";
import { T } from "../lib/theme";

interface Props {
  mediaPath: string;
  hasVideo: boolean;
  onNewProject: () => void;
}

type Rack = "sync" | "eq" | "reverb" | "comp" | "gain";

export default function EditorScreen({ mediaPath, hasVideo, onNewProject }: Props) {
  const videoRef = useRef<VideoRef>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [rack, setRack] = useState<Rack>("sync");
  const [samples, setSamples] = useState<Float32Array | null>(null);

  // Studio / sync state
  const [studioPath, setStudioPath] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "analyzing" | "done" | "low">("idle");
  const [syncOffset, setSyncOffset] = useState(0);
  const [syncConf, setSyncConf] = useState(0);
  const [source, setSource] = useState<"scratch" | "studio">("scratch");

  // FX state
  const [eqName, setEqName] = useState<keyof typeof EQ_PRESETS>("Flat");
  const [eq, setEq] = useState<{ low: number; mid: number; high: number; midFreq: number }>({ ...EQ_PRESETS.Flat });
  const [compName, setCompName] = useState<keyof typeof COMP_PRESETS>("Off");
  const [rvName, setRvName] = useState<keyof typeof REVERB_PRESETS>("Off");
  const [gainDb, setGainDb] = useState(0);
  const [normalize, setNormalize] = useState(false);
  const [peak, setPeak] = useState(1);
  const [bypass, setBypass] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState<string | null>(null);

  // ---- init: load into engine, decode waveform, measure peak ----
  useEffect(() => {
    (async () => {
      await Engine.loadScratch(mediaPath);
      try {
        const p = await Engine.scratchPeak(mediaPath);
        setPeak(p || 1);
      } catch {}
      // Waveform display data (native decode -> peak buckets).
      try {
        const peaks = await waveformPeaks(mediaPath, 400);
        setSamples(peaks.length ? Float32Array.from(peaks) : null);
      } catch {
        setSamples(null);
      }
    })();
  }, [mediaPath]);

  // ---- live params → engine ----
  useEffect(() => { Engine.setEQ(eq); }, [eq]);
  useEffect(() => { Engine.setCompressor(COMP_PRESETS[compName]); }, [compName]);
  useEffect(() => {
    const rv = REVERB_PRESETS[rvName];
    Engine.setReverb(rv.preset, rv.mix);
  }, [rvName]);
  useEffect(() => {
    const norm = normalize && peak > 0 ? 20 * Math.log10(0.891 / peak) : 0;
    Engine.setGainDb(gainDb + norm);
  }, [gainDb, normalize, peak]);
  useEffect(() => { Engine.setBypass(bypass); }, [bypass]);
  useEffect(() => { Engine.setActiveSource(source); }, [source]);
  useEffect(() => { Engine.setSyncOffset(syncOffset); }, [syncOffset]);

  // ---- transport (video is MUTED; engine owns audio) ----
  const togglePlay = async () => {
    if (playing) {
      videoRef.current?.pause();
      Engine.stop();
      setPlaying(false);
    } else {
      videoRef.current?.resume();
      await Engine.playAt(pos);
      setPlaying(true);
    }
  };

  const seekTo = async (fraction: number) => {
    const t = fraction * dur;
    videoRef.current?.seek(t);
    setPos(t);
    if (playing) await Engine.playAt(t);
  };

  // ---- studio import + lock ----
  const importStudio = async () => {
    const [res] = await pick({ type: [types.audio] });
    if (res?.uri) {
      const dest = `${RNFS.CachesDirectoryPath}/studio_${Date.now()}`;
      await RNFS.copyFile(res.uri, dest);
      setStudioPath(dest);
      await Engine.loadStudio(dest);
    }
  };

  const runLock = async () => {
    if (!studioPath) return;
    setSyncState("analyzing");
    try {
      const r = await Sync.computeOffset(mediaPath, studioPath);
      setSyncOffset(r.offsetSec);
      setSyncConf(r.confidence);
      setSyncState(r.confidence >= 1.3 ? "done" : "low");
      setSource("studio");
    } catch {
      setSyncState("low");
    }
  };

  // ---- export ----
  const doExport = async () => {
    setExporting(true);
    setExportDone(null);
    try {
      const irs = await ensureIRs();
      const rv = REVERB_PRESETS[rvName];
      const norm = normalize && peak > 0 ? 20 * Math.log10(0.891 / peak) : 0;
      const out = `${RNFS.DownloadDirectoryPath}/soundreel_${Date.now()}.mp4`;
      const cmd = buildExportCommand({
        videoPath: mediaPath,
        audioPath: source === "studio" && studioPath ? studioPath : mediaPath,
        outPath: out,
        audioIsStudio: source === "studio",
        syncOffsetSec: syncOffset,
        gainDb: gainDb + norm,
        eq,
        comp: compName === "Off" ? null : COMP_PRESETS[compName],
        reverbIRPath: rvName === "Off" ? null : irs[rv.preset],
        reverbMix: rv.mix / 100,
        aspect: "9:16",
        loudnessNormalize: false,
      });
      const session = await FFmpegKit.execute(cmd);
      const rc = await session.getReturnCode();
      setExportDone(ReturnCode.isSuccess(rc) ? out : "FAILED — check logs");
    } catch (e) {
      setExportDone("FAILED — " + String(e));
    }
    setExporting(false);
  };

  const nudge = (ms: number) => setSyncOffset(o => Math.round((o + ms / 1000) * 10000) / 10000);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {hasVideo && (
        <Video ref={videoRef} source={{ uri: "file://" + mediaPath }} style={styles.video}
          muted paused={!playing} resizeMode="contain"
          onProgress={e => setPos(e.currentTime)}
          onLoad={e => setDur(e.duration)}
          onEnd={() => { Engine.stop(); setPlaying(false); }} />
      )}

      <View style={{ marginTop: 12 }}>
        <WaveformView samples={samples} progress={dur ? pos / dur : 0} onSeek={seekTo} />
        <View style={styles.timeRow}>
          <Text style={styles.time}>{fmt(pos)}</Text>
          <Text style={[styles.time, { color: source === "studio" ? T.accent : T.dim }]}>
            {source === "studio" ? "STUDIO AUDIO" : "SCRATCH AUDIO"}
          </Text>
          <Text style={styles.time}>{fmt(dur)}</Text>
        </View>
      </View>

      <View style={styles.transport}>
        <Btn label="New" onPress={onNewProject} />
        <Btn label={playing ? "Pause" : "Play"} primary onPress={togglePlay} />
        <Btn label={bypass ? "FX Off" : "FX On"} onPress={() => setBypass(b => !b)} />
      </View>

      {/* rack */}
      <View style={styles.rack}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rackTabs}>
          {(["sync", "eq", "reverb", "comp", "gain"] as Rack[]).map(r => (
            <Chip key={r} label={r === "sync" ? "Waveform Lock" : r} active={rack === r}
              onPress={() => setRack(r)} />
          ))}
        </ScrollView>
        <View style={{ padding: 14 }}>
          {rack === "sync" && (
            <View>
              {!studioPath ? (
                <Btn label="Import studio track" primary onPress={importStudio} />
              ) : (
                <View>
                  <Btn label={syncState === "idle" ? "◈ Lock to camera take" : "◈ Re-run lock"}
                    primary onPress={runLock} />
                  {syncState === "analyzing" && <Text style={styles.status}>◈ CROSS-CORRELATING…</Text>}
                  {(syncState === "done" || syncState === "low") && (
                    <View style={{ marginTop: 12 }}>
                      <Text style={[styles.status, { color: syncState === "done" ? T.ok : T.accent }]}>
                        {syncState === "done" ? "✓ LOCKED" : "△ LOW CONFIDENCE — CHECK BY EAR"}
                        {"  ·  "}{(syncOffset * 1000).toFixed(1)} ms · {syncConf.toFixed(2)}×
                      </Text>
                      <View style={styles.row}>
                        <Chip label="Scratch" active={source === "scratch"} onPress={() => setSource("scratch")} />
                        <Chip label="Studio" active={source === "studio"} onPress={() => setSource("studio")} />
                      </View>
                      <View style={styles.row}>
                        <Chip label="−10ms" onPress={() => nudge(-10)} />
                        <Chip label="−1ms" onPress={() => nudge(-1)} />
                        <Chip label="+1ms" onPress={() => nudge(1)} />
                        <Chip label="+10ms" onPress={() => nudge(10)} />
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}
          {rack === "eq" && (
            <View>
              <View style={styles.row}>
                {(Object.keys(EQ_PRESETS) as (keyof typeof EQ_PRESETS)[]).map(p => (
                  <Chip key={p} label={p} active={eqName === p}
                    onPress={() => { setEqName(p); setEq({ ...EQ_PRESETS[p] }); }} />
                ))}
              </View>
              <Fader label="Low shelf · 120 Hz" value={eq.low} min={-12} max={12} step={0.5} unit="dB"
                onChange={v => setEq(e => ({ ...e, low: v }))} />
              <Fader label={`Mid peak · ${Math.round(eq.midFreq)} Hz`} value={eq.mid} min={-12} max={12} step={0.5} unit="dB"
                onChange={v => setEq(e => ({ ...e, mid: v }))} />
              <Fader label="Mid frequency" value={eq.midFreq} min={200} max={5000} step={50} unit="Hz"
                onChange={v => setEq(e => ({ ...e, midFreq: v }))} />
              <Fader label="High shelf · 8 kHz" value={eq.high} min={-12} max={12} step={0.5} unit="dB"
                onChange={v => setEq(e => ({ ...e, high: v }))} />
            </View>
          )}
          {rack === "reverb" && (
            <View style={styles.row}>
              {(Object.keys(REVERB_PRESETS) as (keyof typeof REVERB_PRESETS)[]).map(p => (
                <Chip key={p} label={p} active={rvName === p} onPress={() => setRvName(p)} />
              ))}
            </View>
          )}
          {rack === "comp" && (
            <View style={styles.row}>
              {(Object.keys(COMP_PRESETS) as (keyof typeof COMP_PRESETS)[]).map(p => (
                <Chip key={p} label={p} active={compName === p} onPress={() => setCompName(p)} />
              ))}
            </View>
          )}
          {rack === "gain" && (
            <View>
              <Fader label="Output gain" value={gainDb} min={-24} max={24} step={0.5} unit="dB"
                onChange={setGainDb} />
              <Btn label={normalize ? "✓ Normalized to −1 dBFS" : "Normalize to −1 dBFS"}
                onPress={() => setNormalize(n => !n)} />
            </View>
          )}
        </View>
      </View>

      <View style={{ marginTop: 14 }}>
        {!exporting ? (
          <Btn label={source === "studio" ? "Export with synced studio audio" : "Export with processed audio"}
            primary onPress={doExport} />
        ) : (
          <Text style={styles.status}>● EXPORTING VIA FFMPEG…</Text>
        )}
        {exportDone && <Text style={[styles.status, { marginTop: 8 }]}>{exportDone}</Text>}
      </View>
    </ScrollView>
  );
}

function Btn({ label, primary, onPress }: { label: string; primary?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.btn, primary && styles.btnPrimary]}>
      <Text style={[styles.btnText, primary && { color: "#141414" }]}>{label.toUpperCase()}</Text>
    </TouchableOpacity>
  );
}

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  video: { width: "100%", height: 300, backgroundColor: "#000", borderRadius: 6 },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  time: { color: T.dim, fontSize: 10, fontFamily: "monospace" },
  transport: { flexDirection: "row", gap: 8, marginTop: 8 },
  rack: { marginTop: 16, backgroundColor: T.panel, borderWidth: 1, borderColor: T.line, borderRadius: 6 },
  rackTabs: { padding: 10, borderBottomWidth: 1, borderBottomColor: T.line },
  row: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10, gap: 0 },
  status: { color: T.accent, fontSize: 10, letterSpacing: 1.2, fontFamily: "monospace", textAlign: "center", marginTop: 8 },
  btn: {
    flex: 1, paddingVertical: 13, borderWidth: 1, borderColor: T.line, borderRadius: 4,
    alignItems: "center", backgroundColor: "transparent",
  },
  btnPrimary: { backgroundColor: T.accent, borderColor: T.accent },
  btnText: { color: T.text, fontSize: 11, letterSpacing: 1.4, fontFamily: "monospace" },
});

/**
 * TypeScript interface to the SoundReel native audio modules.
 * Parameter ranges mirror the validated web prototype exactly.
 */
import { NativeModules } from "react-native";

const { AudioEngine, WaveformLock } = NativeModules;

export interface LoadResult { durationSec: number }
export interface SyncResult {
  offsetSec: number;        // studioTime = videoTime + offsetSec
  confidence: number;       // >= 1.3 -> "locked"; below -> prompt user to verify by ear
  coarseCorrelation: number;
}

export const EQ_PRESETS = {
  Flat:        { low: 0,  mid: 0,  high: 0,  midFreq: 1000 },
  Vocal:       { low: -2, mid: 3,  high: 2,  midFreq: 2500 },
  AcGuitar:    { low: -1, mid: 2,  high: 3,  midFreq: 3200 },
  Drums:       { low: 4,  mid: -2, high: 3,  midFreq: 500 },
  Bass:        { low: 5,  mid: 1,  high: -2, midFreq: 250 },
} as const;

export const COMP_PRESETS = {
  Off:    { threshold: 0,   ratio: 1,   attack: 0.01,  release: 0.25, makeup: 0 },
  Glue:   { threshold: -18, ratio: 2.5, attack: 0.02,  release: 0.25, makeup: 2 },
  Warmth: { threshold: -24, ratio: 3.5, attack: 0.01,  release: 0.3,  makeup: 4 },
  Punch:  { threshold: -20, ratio: 6,   attack: 0.003, release: 0.12, makeup: 3 },
} as const;

export const REVERB_PRESETS = {
  Off:   { preset: "room",  mix: 0 },
  Room:  { preset: "room",  mix: 18 },
  Hall:  { preset: "hall",  mix: 28 },
  Plate: { preset: "plate", mix: 24 },
} as const;

export const Engine = {
  loadScratch: (path: string): Promise<LoadResult> => AudioEngine.loadScratch(path),
  loadStudio:  (path: string): Promise<LoadResult> => AudioEngine.loadStudio(path),
  playAt:      (videoTimeSec: number): Promise<void> => AudioEngine.playAt(videoTimeSec),
  stop:        (): void => AudioEngine.stop(),

  setEQ: (p: { low: number; mid: number; high: number; midFreq: number }) =>
    AudioEngine.setEQ(p.low, p.mid, p.high, p.midFreq),
  setCompressor: (p: { threshold: number; ratio: number; attack: number; release: number; makeup: number }) =>
    AudioEngine.setCompressor(p.threshold, p.ratio, p.attack, p.release, p.makeup),
  setReverb: (preset: string, mixPercent: number) => AudioEngine.setReverb(preset, mixPercent),
  setGainDb: (db: number) => AudioEngine.setGainDb(db),
  setBypass: (on: boolean) => AudioEngine.setBypass(on),
  setActiveSource: (s: "scratch" | "studio") => AudioEngine.setActiveSource(s),
  setSyncOffset: (sec: number) => AudioEngine.setSyncOffset(sec),

  /** Peak in 0..1 — normalize to -1 dBFS with gainDb = 20*log10(0.891/peak) */
  scratchPeak: (path: string): Promise<number> => AudioEngine.scratchPeak(path),

  /** Renders processed audio offline; resolves with WAV path for FFmpeg muxing. */
  exportProcessedAudio: (): Promise<string> => AudioEngine.exportProcessedAudio(),
};

export const Sync = {
  computeOffset: (scratchPath: string, studioPath: string): Promise<SyncResult> =>
    WaveformLock.computeOffset(scratchPath, studioPath),
};

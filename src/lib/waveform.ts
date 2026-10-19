/**
 * Waveform data for the editor display.
 * Closes the gap flagged in the first app-shell kit: the editor rendered but
 * had no sample data, because nothing exposed decoded PCM to JS.
 */
import { NativeModules } from "react-native";

const { WaveformLock } = NativeModules;

/** Peak magnitudes (0..1), one per horizontal pixel bucket. */
export async function waveformPeaks(path: string, buckets = 400): Promise<number[]> {
  try {
    return await WaveformLock.waveformPeaks(path, buckets);
  } catch {
    return [];
  }
}

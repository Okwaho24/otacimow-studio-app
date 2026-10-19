/**
 * Generates the reverb impulse-response WAVs on first launch (room/hall/plate).
 * Same synthesis as the validated prototype: exponential-decay noise, stereo.
 */
import RNFS from "react-native-fs";

const RATE = 48000;

function irSamples(decaySec: number): Float32Array[] {
  const len = Math.max(1, Math.floor(RATE * decaySec));
  const chans = [new Float32Array(len), new Float32Array(len)];
  for (const ch of chans) {
    for (let i = 0; i < len; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
  }
  return chans;
}

function encodeWav(chans: Float32Array[]): Uint8Array {
  const n = chans[0].length, numCh = chans.length;
  const dataLen = n * numCh * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * numCh * 2, true); v.setUint16(32, numCh * 2, true);
  v.setUint16(34, 16, true); ws(36, "data"); v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < numCh; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return new Uint8Array(buf);
}

function toBase64(bytes: Uint8Array): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += chars[(b >> 18) & 63] + chars[(b >> 12) & 63] +
      (i + 1 < bytes.length ? chars[(b >> 6) & 63] : "=") +
      (i + 2 < bytes.length ? chars[b & 63] : "=");
  }
  return out;
}

export const IR_DECAYS: Record<string, number> = { room: 0.5, hall: 2.4, plate: 1.2 };

export async function ensureIRs(): Promise<Record<string, string>> {
  const paths: Record<string, string> = {};
  for (const [name, decay] of Object.entries(IR_DECAYS)) {
    const path = `${RNFS.DocumentDirectoryPath}/ir_${name}.wav`;
    paths[name] = path;
    if (!(await RNFS.exists(path))) {
      const wav = encodeWav(irSamples(decay));
      await RNFS.writeFile(path, toBase64(wav), "base64");
    }
  }
  return paths;
}

/**
 * Builds the FFmpeg command for offline export.
 * Preview uses platform effects; export runs this filter chain — the source of truth.
 */
export interface ExportParams {
  videoPath: string;
  audioPath: string;          // scratch source == videoPath; studio == studio file
  outPath: string;
  audioIsStudio: boolean;
  syncOffsetSec: number;      // studioTime = videoTime + offset
  gainDb: number;
  eq: { low: number; mid: number; high: number; midFreq: number };
  comp: { threshold: number; ratio: number; attack: number; release: number; makeup: number } | null;
  reverbIRPath: string | null; // pre-generated IR wav, null = no reverb
  reverbMix: number;           // 0..1
  aspect: "9:16" | "1:1" | "16:9";
  loudnessNormalize: boolean;
}

const SCALES: Record<ExportParams["aspect"], string> = {
  "9:16": "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
  "1:1": "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2",
  "16:9": "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
};

export function buildExportCommand(p: ExportParams): string {
  const af: string[] = [];

  let audioInput = `-i "${p.audioPath}"`;
  if (p.audioIsStudio && p.syncOffsetSec > 0.0005) {
    audioInput = `-ss ${p.syncOffsetSec.toFixed(4)} -i "${p.audioPath}"`;
  } else if (p.audioIsStudio && p.syncOffsetSec < -0.0005) {
    const ms = Math.round(-p.syncOffsetSec * 1000);
    af.push(`adelay=${ms}|${ms}`);
  }

  if (Math.abs(p.gainDb) > 0.01) af.push(`volume=${p.gainDb.toFixed(2)}dB`);
  if (Math.abs(p.eq.low) > 0.01) af.push(`bass=g=${p.eq.low.toFixed(1)}:f=120:w=0.5`);
  if (Math.abs(p.eq.mid) > 0.01)
    af.push(`equalizer=f=${Math.round(p.eq.midFreq)}:t=q:w=1:g=${p.eq.mid.toFixed(1)}`);
  if (Math.abs(p.eq.high) > 0.01) af.push(`treble=g=${p.eq.high.toFixed(1)}:f=8000:w=0.5`);

  if (p.comp && p.comp.ratio > 1.01) {
    af.push(
      `acompressor=threshold=${p.comp.threshold}dB:ratio=${p.comp.ratio}` +
      `:attack=${Math.round(p.comp.attack * 1000)}:release=${Math.round(p.comp.release * 1000)}` +
      `:makeup=${p.comp.makeup}dB`
    );
  }

  if (p.reverbIRPath && p.reverbMix > 0.005) {
    const wet = Math.round(p.reverbMix * 100);
    af.push(`afir=dry=${100 - wet}:wet=${wet}`);
  }

  if (p.loudnessNormalize) af.push(`loudnorm=I=-14:TP=-1.0:LRA=11`);

  const reverbInput = p.reverbIRPath && p.reverbMix > 0.005 ? `-i "${p.reverbIRPath}"` : "";
  const afStr = af.length ? `-af "${af.join(",")}"` : "";

  return [
    `-y -i "${p.videoPath}"`, audioInput, reverbInput,
    `-map 0:v:0 -map 1:a:0`,
    afStr,
    `-c:v libx264 -preset medium -b:v 6M -maxrate 8M -bufsize 12M`,
    `-vf "${SCALES[p.aspect]}"`,
    `-r 30 -pix_fmt yuv420p -c:a aac -b:a 256k -ar 48000`,
    `-movflags +faststart -shortest "${p.outPath}"`,
  ].filter(Boolean).join(" ");
}

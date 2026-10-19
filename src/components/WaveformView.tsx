import React, { useMemo } from "react";
import { View, StyleSheet, GestureResponderEvent, LayoutChangeEvent } from "react-native";
import Svg, { Rect, Line } from "react-native-svg";
import { T } from "../lib/theme";

interface Props {
  /** Downsampled mono PCM (from PcmDecoder via a small bridge call, or precomputed) */
  samples: Float32Array | number[] | null;
  progress: number; // 0..1
  height?: number;
  onSeek?: (fraction: number) => void;
}

/** Waveform-first hero view: min/max bars, played region in accent, tap-to-seek. */
export default function WaveformView({ samples, progress, height = 84, onSeek }: Props) {
  const [width, setWidth] = React.useState(0);

  const bars = useMemo(() => {
    if (!samples || !width) return [];
    const n = samples.length;
    const cols = Math.floor(width);
    const step = Math.max(1, Math.floor(n / cols));
    const out: { x: number; y: number; h: number }[] = [];
    for (let x = 0; x < cols; x++) {
      // Native peaks are magnitudes (0..1); mirror them around zero so the
      // display reads as a normal waveform rather than a half-wave.
      let mx = 0;
      const start = x * step;
      for (let i = 0; i < step; i++) {
        const v = Math.abs(Number(samples[start + i] ?? 0));
        if (v > mx) mx = v;
      }
      const mn = -mx;
      const mid = height / 2;
      const y1 = mid + mn * mid * 0.92;
      const y2 = mid + mx * mid * 0.92;
      out.push({ x, y: y1, h: Math.max(1, y2 - y1) });
    }
    return out;
  }, [samples, width, height]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onTouch = (e: GestureResponderEvent) => {
    if (!onSeek || !width) return;
    onSeek(Math.max(0, Math.min(1, e.nativeEvent.locationX / width)));
  };

  const playedX = progress * width;

  return (
    <View style={[styles.wrap, { height }]} onLayout={onLayout}
          onStartShouldSetResponder={() => true} onResponderRelease={onTouch}>
      <Svg width={width} height={height}>
        {bars.map((b, i) => (
          <Rect key={i} x={b.x} y={b.y} width={1} height={b.h}
                fill={b.x <= playedX ? T.accent : "#3A3D46"} />
        ))}
        <Line x1={playedX} y1={0} x2={playedX} y2={height} stroke={T.accent} strokeWidth={1.5} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: T.panel, borderWidth: 1, borderColor: T.line, borderRadius: 6, overflow: "hidden" },
});

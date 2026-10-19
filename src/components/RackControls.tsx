import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import Slider from "@react-native-community/slider";
import { T } from "../lib/theme";

export function Chip({ label, active, onPress, disabled }: {
  label: string; active?: boolean; onPress: () => void; disabled?: boolean;
}) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled}
      style={[styles.chip, active && styles.chipActive, disabled && { opacity: 0.4 }]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label.toUpperCase()}</Text>
    </TouchableOpacity>
  );
}

export function Fader({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; onChange: (v: number) => void;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={styles.faderRow}>
        <Text style={styles.faderLabel}>{label.toUpperCase()}</Text>
        <Text style={styles.faderValue}>
          {value > 0 && unit === "dB" ? "+" : ""}{Math.round(value * 10) / 10}{unit}
        </Text>
      </View>
      <Slider minimumValue={min} maximumValue={max} step={step} value={value}
        onValueChange={onChange}
        minimumTrackTintColor={T.accent} maximumTrackTintColor={T.line}
        thumbTintColor={T.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 8, paddingHorizontal: 10, backgroundColor: T.panel2,
    borderWidth: 1, borderColor: T.line, borderRadius: 4, marginRight: 6, marginBottom: 6,
  },
  chipActive: { backgroundColor: T.accent, borderColor: T.accent },
  chipText: { color: T.dim, fontSize: 10, letterSpacing: 1.2, fontFamily: "monospace" },
  chipTextActive: { color: "#141414" },
  faderRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  faderLabel: { color: T.dim, fontSize: 10, letterSpacing: 1, fontFamily: "monospace" },
  faderValue: { color: T.accent, fontSize: 10, fontFamily: "monospace" },
});

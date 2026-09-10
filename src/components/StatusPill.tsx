import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

interface StatusPillProps {
  modelsReady: boolean;
  downloadLabel: string | null;
  downloadPercent: number | null;
}

const MODEL_LABELS: Record<string, string> = {
  llm: 'Modelo de intención (Llama 3.2)',
  stt: 'Modelo de voz a texto (Whisper)',
  tts: 'Modelo de voz (Supertonic)'
};

export function StatusPill({ modelsReady, downloadLabel, downloadPercent }: StatusPillProps) {
  if (modelsReady) {
    return (
      <View style={[styles.pill, styles.ready]}>
        <Text style={styles.dot}>●</Text>
        <Text style={styles.text}>Todo corre en este dispositivo, sin conexión</Text>
      </View>
    );
  }

  const label = downloadLabel ? MODEL_LABELS[downloadLabel] ?? downloadLabel : 'Preparando modelos on-device…';
  const percentText = downloadPercent != null ? ` ${Math.round(downloadPercent)}%` : '';

  return (
    <View style={[styles.pill, styles.loading]}>
      <Text style={styles.dot}>●</Text>
      <Text style={styles.text}>
        {label}
        {percentText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignSelf: 'center'
  },
  ready: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)'
  },
  loading: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)'
  },
  dot: {
    color: theme.accent,
    fontSize: 10
  },
  text: {
    color: theme.textMuted,
    fontSize: 13
  }
});

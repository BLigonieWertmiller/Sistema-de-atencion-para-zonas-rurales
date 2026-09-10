import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MicButton } from '../components/MicButton';
import { StatusPill } from '../components/StatusPill';
import type { FieldAgentState } from '../hooks/useFieldAgent';
import { theme } from '../theme';

export function HomeScreen({ agent }: { agent: FieldAgentState }) {
  return (
    <View style={styles.container}>
      <StatusPill
        modelsReady={agent.modelsReady}
        downloadLabel={agent.downloadLabel}
        downloadPercent={agent.downloadPercent}
      />

      <View style={styles.center}>
        <MicButton
          phase={agent.phase}
          disabled={false}
          onPressIn={() => void agent.startRecording()}
          onPressOut={() => void agent.stopRecordingAndProcess()}
        />
      </View>

      <View style={styles.feedback}>
        {agent.lastTranscript && (
          <Text style={styles.transcript} numberOfLines={2}>
            “{agent.lastTranscript}”
          </Text>
        )}
        {agent.lastConfirmation && <Text style={styles.confirmation}>{agent.lastConfirmation}</Text>}
        {agent.errorMessage && <Text style={styles.error}>{agent.errorMessage}</Text>}
      </View>

      <Text style={styles.hint}>
        Decí, por ejemplo: “registrá que revisé el poste 12” · “generá el reporte del día” · “traducí
        esto al portugués” · “marcá el poste 14 como revisado”
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
    paddingTop: 24,
    paddingBottom: 16,
    justifyContent: 'space-between'
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  feedback: {
    minHeight: 80,
    paddingHorizontal: 24,
    gap: 8,
    alignItems: 'center'
  },
  transcript: {
    color: theme.textMuted,
    fontSize: 15,
    fontStyle: 'italic',
    textAlign: 'center'
  },
  confirmation: {
    color: theme.accent,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center'
  },
  error: {
    color: theme.danger,
    fontSize: 15,
    textAlign: 'center'
  },
  hint: {
    color: theme.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 24
  }
});

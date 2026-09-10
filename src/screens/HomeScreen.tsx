import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MicButton } from '../components/MicButton';
import { SosButton } from '../components/SosButton';
import { StatusPill } from '../components/StatusPill';
import type { FieldAgentState } from '../hooks/useFieldAgent';
import type { PeerSyncState } from '../hooks/usePeerSync';
import { theme } from '../theme';

export function HomeScreen({ agent, peer }: { agent: FieldAgentState; peer: PeerSyncState }) {
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.topRowSpacer} />
        <StatusPill
          modelsReady={agent.modelsReady}
          downloadLabel={agent.downloadLabel}
          downloadPercent={agent.downloadPercent}
        />
        <View style={styles.topRowSpacer}>
          <SosButton peerCount={peer.peerCount} onSent={() => void agent.refreshEntries()} />
        </View>
      </View>

      {peer.lastReceivedSos && (
        <View style={styles.sosBanner}>
          <Text style={styles.sosBannerText}>
            🆘 Alerta de {peer.lastReceivedSos.payload.deviceName}
            {peer.lastReceivedSos.payload.latitude != null
              ? ` · ${peer.lastReceivedSos.payload.latitude.toFixed(4)}, ${peer.lastReceivedSos.payload.longitude?.toFixed(4)}`
              : ''}
          </Text>
        </View>
      )}

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
    paddingTop: 16,
    paddingBottom: 16,
    justifyContent: 'space-between'
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16
  },
  topRowSpacer: {
    width: 64,
    alignItems: 'flex-end'
  },
  sosBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    borderWidth: 1,
    borderColor: theme.danger
  },
  sosBannerText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center'
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

import React from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { EntryRow } from '../components/EntryRow';
import type { FieldAgentState } from '../hooks/useFieldAgent';
import type { PeerSyncState } from '../hooks/usePeerSync';
import { theme } from '../theme';

export function BitacoraScreen({ agent, peer }: { agent: FieldAgentState; peer: PeerSyncState }) {
  const [refreshing, setRefreshing] = React.useState(false);
  const [codeDraft, setCodeDraft] = React.useState(peer.teamCode ?? '');

  React.useEffect(() => {
    if (peer.teamCode != null) setCodeDraft(peer.teamCode);
  }, [peer.teamCode]);

  const onRefresh = async () => {
    setRefreshing(true);
    await agent.refreshEntries();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bitácora de hoy</Text>
      <FlatList
        data={agent.todayEntries}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <EntryRow entry={item} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>Todavía no hay registros hoy.</Text>}
        contentContainerStyle={agent.todayEntries.length === 0 ? styles.emptyContainer : undefined}
      />

      <View style={styles.teamCard}>
        <Text style={styles.teamTitle}>Cuadrilla (P2P sin señal)</Text>
        <Text style={styles.teamStatus}>
          {peer.peerCount > 0
            ? `Conectado a ${peer.peerCount} ${peer.peerCount === 1 ? 'par' : 'pares'}`
            : 'Sin pares conectados'}
        </Text>
        <View style={styles.teamRow}>
          <TextInput
            value={codeDraft}
            onChangeText={setCodeDraft}
            placeholder="Código de cuadrilla (ej: cerro-norte-9set)"
            placeholderTextColor={theme.textMuted}
            style={styles.teamInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={styles.teamButton} onPress={() => void peer.setTeamCode(codeDraft)}>
            <Text style={styles.teamButtonText}>Unirse</Text>
          </Pressable>
        </View>
        <Text style={styles.teamHint}>
          Todos con el mismo código y en el mismo rango se sincronizan entre sí, sin depender de datos
          móviles.
        </Text>
      </View>

      <Pressable style={styles.reportButton} onPress={() => void agent.generateReportNow()}>
        <Text style={styles.reportButtonText}>Generar reporte del día</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
    paddingTop: 24
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 12
  },
  empty: {
    color: theme.textMuted,
    textAlign: 'center'
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center'
  },
  teamCard: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 6
  },
  teamTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700'
  },
  teamStatus: {
    color: theme.accent,
    fontSize: 12
  },
  teamRow: {
    flexDirection: 'row',
    gap: 8
  },
  teamInput: {
    flex: 1,
    color: theme.text,
    fontSize: 13,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  teamButton: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: theme.accentPressed
  },
  teamButtonText: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 13
  },
  teamHint: {
    color: theme.textMuted,
    fontSize: 10.5,
    lineHeight: 14
  },
  reportButton: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center'
  },
  reportButtonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600'
  }
});

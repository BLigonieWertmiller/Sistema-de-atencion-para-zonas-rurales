import React from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { EntryRow } from '../components/EntryRow';
import type { FieldAgentState } from '../hooks/useFieldAgent';
import { theme } from '../theme';

export function BitacoraScreen({ agent }: { agent: FieldAgentState }) {
  const [refreshing, setRefreshing] = React.useState(false);

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

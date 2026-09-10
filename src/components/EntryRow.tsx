import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';
import type { LogEntry } from '../types';

const TYPE_ICON: Record<LogEntry['type'], string> = {
  nota: '📝',
  traduccion: '🌐',
  checklist: '✅',
  reporte: '📄',
  sos: '🆘'
};

export function EntryRow({ entry }: { entry: LogEntry }) {
  const time = new Date(entry.createdAt).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <View style={styles.row}>
      <Text style={styles.icon}>{TYPE_ICON[entry.type]}</Text>
      <View style={styles.content}>
        <Text style={[styles.text, entry.type === 'sos' && styles.sosText]}>{entry.text}</Text>
        <Text style={styles.meta}>
          {time}
          {entry.latitude != null && entry.longitude != null ? ' · con ubicación' : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border
  },
  icon: {
    fontSize: 20
  },
  content: {
    flex: 1
  },
  text: {
    color: theme.text,
    fontSize: 16
  },
  sosText: {
    color: theme.danger,
    fontWeight: '700'
  },
  meta: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 2
  }
});

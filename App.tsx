import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { BitacoraScreen } from './src/screens/BitacoraScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { useFieldAgent } from './src/hooks/useFieldAgent';
import { theme } from './src/theme';

type Tab = 'inicio' | 'bitacora';

export default function App() {
  const [tab, setTab] = useState<Tab>('inicio');
  const agent = useFieldAgent();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {tab === 'inicio' ? <HomeScreen agent={agent} /> : <BitacoraScreen agent={agent} />}

      <View style={styles.tabBar}>
        <TabButton label="🎙️ Agente" active={tab === 'inicio'} onPress={() => setTab('inicio')} />
        <TabButton
          label={`📋 Bitácora (${agent.todayEntries.length})`}
          active={tab === 'bitacora'}
          onPress={() => setTab('bitacora')}
        />
      </View>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tabButton, active && styles.tabButtonActive]} onPress={onPress}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.background
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.surface
  },
  tabButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center'
  },
  tabButtonActive: {
    borderTopWidth: 2,
    borderTopColor: theme.accent
  },
  tabLabel: {
    color: theme.textMuted,
    fontSize: 14
  },
  tabLabelActive: {
    color: theme.text,
    fontWeight: '700'
  }
});

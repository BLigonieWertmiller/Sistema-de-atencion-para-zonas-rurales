import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '../theme';
import type { AgentPhase } from '../types';

interface MicButtonProps {
  phase: AgentPhase;
  disabled: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
}

const PHASE_LABEL: Record<AgentPhase, string> = {
  inactivo: 'Mantené presionado y hablá',
  escuchando: 'Escuchando… soltá para procesar',
  transcribiendo: 'Transcribiendo…',
  pensando: 'Pensando…',
  confirmando: 'Listo',
  error: 'Probá de nuevo'
};

/**
 * Botón único, grande, pensado para operarse con guantes y sin mirar la
 * pantalla: mantener presionado graba, soltar dispara todo el pipeline.
 */
export function MicButton({ phase, disabled, onPressIn, onPressOut }: MicButtonProps) {
  const isBusy = phase === 'transcribiendo' || phase === 'pensando';
  const isListening = phase === 'escuchando';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Mantené presionado para grabar un comando de voz"
      disabled={disabled || isBusy}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        styles.button,
        isListening && styles.buttonListening,
        (pressed || isListening) && styles.buttonPressed,
        (disabled || isBusy) && styles.buttonDisabled
      ]}
    >
      {isBusy ? (
        <ActivityIndicator color={theme.text} size="large" />
      ) : (
        <Text style={styles.icon}>🎙️</Text>
      )}
      <Text style={styles.label}>{PHASE_LABEL[phase]}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: theme.surface,
    borderWidth: 4,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12
  },
  buttonListening: {
    backgroundColor: theme.accentPressed,
    borderColor: theme.accent
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }]
  },
  buttonDisabled: {
    opacity: 0.6
  },
  icon: {
    fontSize: 64
  },
  label: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 16
  }
});

import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

import type { PeerSyncState } from '../hooks/usePeerSync';
import { signSos } from '../p2p/signing';
import { addLogEntry } from '../services/database';
import { getDeviceName, getOrCreateDeviceId } from '../services/identity';
import { getCurrentGeoTag } from '../services/location';
import { theme } from '../theme';

const HOLD_MS = 1800;
const TICK_MS = 60;

interface SosButtonProps {
  peer: PeerSyncState;
  onSent: () => void;
}

/**
 * Botón de emergencia, deliberadamente separado del flujo de voz: en una
 * emergencia real no podemos depender de que el LLM interprete bien una
 * frase hablada bajo estrés. Requiere mantener presionado ~2s (como el SOS
 * de un celular) para evitar toques accidentales, y funciona sin importar
 * el estado del agente o si los modelos on-device ya cargaron.
 *
 * Lo más común en el campo es que nadie esté conectado en el instante
 * exacto en que se aprieta el botón — por eso `peer.relaySos` no solo
 * manda la alerta a quien esté conectado ahora, sino que la deja guardada
 * para pasársela automáticamente a la próxima persona que aparezca en
 * rango (ver `usePeerSync`).
 */
export function SosButton({ peer, onSent }: SosButtonProps) {
  const [progress, setProgress] = useState(0);
  const [sent, setSent] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    elapsedRef.current = 0;
    setProgress(0);
  }

  function startHold() {
    setSent(null);
    void Haptics.selectionAsync();
    elapsedRef.current = 0;
    timerRef.current = setInterval(() => {
      elapsedRef.current += TICK_MS;
      const next = Math.min(1, elapsedRef.current / HOLD_MS);
      setProgress(next);
      if (next >= 1) {
        clearTimer();
        void triggerSos();
      }
    }, TICK_MS);
  }

  async function triggerSos() {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    const [location, deviceName, deviceId] = await Promise.all([
      getCurrentGeoTag(),
      getDeviceName(),
      getOrCreateDeviceId()
    ]);
    const sentAt = new Date().toISOString();

    await addLogEntry('sos', 'Alerta SOS enviada', location, { deviceId, deviceName });

    const connectedPeers = peer.peerCount;
    const unsigned = {
      deviceId,
      deviceName,
      sentAt,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null
    };
    await peer.relaySos({ ...unsigned, sig: await signSos(unsigned) });

    const confirmation =
      connectedPeers > 0
        ? `Alerta enviada a ${connectedPeers} ${connectedPeers === 1 ? 'par conectado' : 'pares conectados'}.`
        : 'Guardada. Sin pares conectados ahora — se manda sola apenas aparezca uno.';

    setSent(confirmation);
    Speech.speak(`Alerta S O S. ${confirmation}`, { language: 'es-ES' });
    onSent();
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mantené presionado dos segundos para enviar una alerta de emergencia"
        onPressIn={startHold}
        onPressOut={clearTimer}
        style={styles.button}
      >
        <View style={[styles.fill, { height: `${progress * 100}%` }]} />
        <Text style={styles.label}>SOS</Text>
      </Pressable>
      <Text style={styles.hint}>
        {progress > 0 ? 'Mantené presionado…' : `Mantené presionado 2s · ${peer.peerCount} par(es) conectados`}
      </Text>
      {sent && <Text style={styles.confirmation}>{sent}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  button: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: theme.danger,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: theme.surface
  },
  fill: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.danger,
    opacity: 0.45
  },
  label: {
    color: theme.text,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.5
  },
  hint: {
    color: theme.textMuted,
    fontSize: 10.5,
    textAlign: 'center',
    maxWidth: 150
  },
  confirmation: {
    color: theme.danger,
    fontSize: 11.5,
    fontWeight: '700',
    textAlign: 'center',
    maxWidth: 160
  }
});

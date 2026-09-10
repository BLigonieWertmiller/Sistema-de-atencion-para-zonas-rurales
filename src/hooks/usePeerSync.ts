import { useCallback, useEffect, useRef, useState } from 'react';

import { addLogEntry, markReceived, wasAlreadyReceived } from '../services/database';
import { getDeviceName, getOrCreateDeviceId, getTeamCode, setTeamCode as persistTeamCode } from '../services/identity';
import { peerSync } from '../p2p/peerSync';
import type { EntryPayload, PeerMessageEvent, SosPayload } from '../p2p/protocol';
import type { LogEntry } from '../types';

export interface ReceivedSos {
  payload: SosPayload;
  receivedAt: string;
}

export interface PeerSyncState {
  /** null mientras no se cargó el código de cuadrilla guardado; '' si nunca se configuró uno. */
  teamCode: string | null;
  peerCount: number;
  lastReceivedSos: ReceivedSos | null;
  setTeamCode: (code: string) => Promise<void>;
  /** Para que useFieldAgent avise cuando el usuario genera una entrada nueva, y se la mande a los pares conectados. */
  broadcastNewEntry: (entry: LogEntry) => Promise<void>;
}

function dedupKeyForSos(payload: SosPayload): string {
  return `sos:${payload.deviceId}:${payload.sentAt}`;
}

function dedupKeyForEntry(payload: EntryPayload): string {
  return `entry:${payload.deviceId}:${payload.createdAt}`;
}

/**
 * Conecta la app al swarm P2P de la cuadrilla (si hay un código configurado)
 * y refleja localmente lo que llega de otros pares: alertas SOS y entradas
 * de bitácora. Ver `src/p2p/peerSync.ts` para el transporte y
 * `p2p/worklet.js` para lo que corre del lado Bare/Hyperswarm.
 *
 * Sincronización a un solo salto: cada par comparte lo que él mismo generó
 * con los pares a los que está conectado directamente — no hay reenvío
 * multi-hop en este MVP, así que "en rango" significa conexión directa
 * (misma red local), no "en algún punto de la cadena de la cuadrilla".
 */
export function usePeerSync(onEntriesChanged?: () => void): PeerSyncState {
  const [teamCode, setTeamCodeState] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [lastReceivedSos, setLastReceivedSos] = useState<ReceivedSos | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    peerSync.start();

    const offPeerCount = peerSync.onPeerCountChange(setPeerCount);
    const offMessage = peerSync.onMessage((event: PeerMessageEvent) => {
      void handleIncomingMessage(event);
    });

    void (async () => {
      const savedCode = await getTeamCode();
      setTeamCodeState(savedCode ?? '');
      if (savedCode) void peerSync.join(savedCode);
    })();

    return () => {
      offPeerCount();
      offMessage();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleIncomingMessage(event: PeerMessageEvent): Promise<void> {
    if (event.type === 'sos') {
      const payload = event.payload;
      const key = dedupKeyForSos(payload);
      if (await wasAlreadyReceived(key)) return;
      await markReceived(key);

      setLastReceivedSos({ payload, receivedAt: new Date().toISOString() });
      await addLogEntry(
        'sos',
        `Alerta SOS de ${payload.deviceName}`,
        payload.latitude != null && payload.longitude != null
          ? { latitude: payload.latitude, longitude: payload.longitude }
          : null,
        { fromPeer: true, deviceName: payload.deviceName, deviceId: payload.deviceId }
      );
      onEntriesChanged?.();
      return;
    }

    const payload = event.payload;
    const key = dedupKeyForEntry(payload);
    if (await wasAlreadyReceived(key)) return;
    await markReceived(key);

    await addLogEntry(
      payload.type,
      `${payload.text} (de ${payload.deviceName})`,
      payload.latitude != null && payload.longitude != null
        ? { latitude: payload.latitude, longitude: payload.longitude }
        : null,
      { fromPeer: true, deviceName: payload.deviceName, deviceId: payload.deviceId }
    );
    onEntriesChanged?.();
  }

  const setTeamCode = useCallback(async (code: string) => {
    const trimmed = code.trim();
    await persistTeamCode(trimmed);
    setTeamCodeState(trimmed);
    peerSync.leave();
    if (trimmed) void peerSync.join(trimmed);
  }, []);

  const broadcastNewEntry = useCallback(async (entry: LogEntry) => {
    if (entry.type !== 'nota' && entry.type !== 'checklist' && entry.type !== 'traduccion') return;
    const [deviceName, deviceId] = await Promise.all([getDeviceName(), getOrCreateDeviceId()]);

    peerSync.broadcastEntry({
      deviceId,
      deviceName,
      type: entry.type,
      text: entry.text,
      createdAt: entry.createdAt,
      latitude: entry.latitude,
      longitude: entry.longitude
    });
  }, []);

  return { teamCode, peerCount, lastReceivedSos, setTeamCode, broadcastNewEntry };
}

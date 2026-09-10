import { useCallback, useEffect, useRef, useState } from 'react';

import {
  addLogEntry,
  addToOutbox,
  getOutboxItems,
  markReceived,
  pruneOutbox,
  wasAlreadyReceived
} from '../services/database';
import { getDeviceName, getOrCreateDeviceId, getTeamCode, setTeamCode as persistTeamCode } from '../services/identity';
import { ensureBlePermissions } from '../p2p/blePermissions';
import { peerSync } from '../p2p/peerSync';
import {
  dedupKeyForEntry,
  dedupKeyForSos,
  type EntryPayload,
  type PeerMessageEvent,
  type SosPayload
} from '../p2p/protocol';
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
  /** Manda (y deja pendiente de relayar) una alerta SOS ya armada por SosButton. */
  relaySos: (payload: SosPayload) => Promise<void>;
}

/**
 * Cuánto tiempo se sigue cargando y relayando un mensaje a nuevos peers
 * después de originado o escuchado. Pasado este plazo, deja de propagarse
 * (sigue en la bitácora local igual) — no tiene sentido reenviar una
 * emergencia de hace tres días como si fuera de ahora.
 */
const RELAY_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Conecta la app al swarm P2P de la cuadrilla (si hay un código configurado)
 * y refleja localmente lo que llega de otros pares: alertas SOS y entradas
 * de bitácora. Ver `src/p2p/peerSync.ts` para el transporte y
 * `p2p/worklet.js` para lo que corre del lado Bare/Hyperswarm.
 *
 * Store-and-forward, no solo un salto: lo más común en el campo es que
 * nadie esté conectado en el instante exacto en que se genera un SOS o una
 * nota — así que además de mandarlo a quien esté conectado en ese momento,
 * todo mensaje (propio o escuchado de otro peer) queda en un "buzón" local
 * (`relay_outbox`) y se le pasa automáticamente a la próxima persona que
 * aparezca en rango, así nunca haya visto al que lo originó. El dedup por
 * `(deviceId, timestamp)` evita que se guarde o se muestre dos veces.
 */
export function usePeerSync(onEntriesChanged?: () => void): PeerSyncState {
  const [teamCode, setTeamCodeState] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [lastReceivedSos, setLastReceivedSos] = useState<ReceivedSos | null>(null);
  const startedRef = useRef(false);
  const teamCodeRef = useRef<string>('');
  const previousPeerCountRef = useRef(0);
  const deviceIdRef = useRef<string | null>(null);

  const flushOutbox = useCallback(async () => {
    const code = teamCodeRef.current;
    if (!code) return;

    const items = await getOutboxItems(code, RELAY_TTL_MS);
    for (const item of items) {
      if (item.kind === 'sos') {
        peerSync.broadcastSos(item.payload as SosPayload);
      } else {
        peerSync.broadcastEntry(item.payload as EntryPayload);
      }
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    peerSync.start();
    void pruneOutbox(RELAY_TTL_MS);
    void getOrCreateDeviceId().then((id) => {
      deviceIdRef.current = id;
    });

    const offPeerCount = peerSync.onPeerCountChange((count) => {
      setPeerCount(count);
      // Un peer nuevo apareció (no solo uno se fue): es el momento de
      // pasarle todo lo que tengamos pendiente en el buzón.
      if (count > previousPeerCountRef.current) void flushOutbox();
      previousPeerCountRef.current = count;
    });
    const offMessage = peerSync.onMessage((event: PeerMessageEvent) => {
      void handleIncomingMessage(event);
    });

    void (async () => {
      const savedCode = await getTeamCode();
      teamCodeRef.current = savedCode ?? '';
      setTeamCodeState(savedCode ?? '');
      if (savedCode) {
        await ensureBlePermissions();
        void peerSync.join(savedCode);
      }
    })();

    return () => {
      offPeerCount();
      offMessage();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleIncomingMessage(event: PeerMessageEvent): Promise<void> {
    // Un mensaje propio que volvió rebotado por el buzón de otro peer — ya
    // lo tenemos, no es una alerta nueva de nadie.
    if (event.payload.deviceId === deviceIdRef.current) return;

    const code = teamCodeRef.current;

    if (event.type === 'sos') {
      const payload = event.payload;
      const key = dedupKeyForSos(payload);
      if (await wasAlreadyReceived(key)) return;
      await markReceived(key);
      if (code) await addToOutbox(key, 'sos', payload, code);

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
    if (code) await addToOutbox(key, 'entry', payload, code);

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
    teamCodeRef.current = trimmed;
    setTeamCodeState(trimmed);
    peerSync.leave();
    if (trimmed) {
      await ensureBlePermissions();
      void peerSync.join(trimmed);
    }
  }, []);

  const broadcastNewEntry = useCallback(async (entry: LogEntry) => {
    if (entry.type !== 'nota' && entry.type !== 'checklist' && entry.type !== 'traduccion') return;
    const [deviceName, deviceId] = await Promise.all([getDeviceName(), getOrCreateDeviceId()]);

    const payload: EntryPayload = {
      deviceId,
      deviceName,
      type: entry.type,
      text: entry.text,
      createdAt: entry.createdAt,
      latitude: entry.latitude,
      longitude: entry.longitude
    };

    peerSync.broadcastEntry(payload);
    const code = teamCodeRef.current;
    if (code) await addToOutbox(dedupKeyForEntry(payload), 'entry', payload, code);
  }, []);

  const relaySos = useCallback(async (payload: SosPayload) => {
    peerSync.broadcastSos(payload);
    const code = teamCodeRef.current;
    if (code) await addToOutbox(dedupKeyForSos(payload), 'sos', payload, code);
  }, []);

  return { teamCode, peerCount, lastReceivedSos, setTeamCode, broadcastNewEntry, relaySos };
}

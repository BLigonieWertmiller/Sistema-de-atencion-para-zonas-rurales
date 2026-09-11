import { useCallback, useEffect, useRef, useState } from 'react';

import {
  addLogEntry,
  addToOutbox,
  getAllTeammateCheckins,
  getOutboxItems,
  markReceived,
  pruneOutbox,
  upsertOutboxCheckin,
  upsertTeammateCheckin,
  wasAlreadyReceived
} from '../services/database';
import { getDeviceName, getOrCreateDeviceId, getTeamCode, setTeamCode as persistTeamCode } from '../services/identity';
import { getCurrentGeoTag } from '../services/location';
import { ensureBlePermissions } from '../p2p/blePermissions';
import { peerSync } from '../p2p/peerSync';
import {
  dedupKeyForEntry,
  dedupKeyForSos,
  outboxKeyForCheckin,
  type CheckinPayload,
  type EntryPayload,
  type PeerMessageEvent,
  type SosPayload
} from '../p2p/protocol';
import { signCheckin, signEntry } from '../p2p/signing';
import type { LogEntry } from '../types';

export interface ReceivedSos {
  payload: SosPayload;
  receivedAt: string;
}

export interface TeammateStatus {
  deviceId: string;
  deviceName: string;
  lastSeenAt: string;
  /** Hace más de OVERDUE_THRESHOLD_MS que no se sabe nada de este dispositivo. */
  overdue: boolean;
}

export interface PeerSyncState {
  /** null mientras no se cargó el código de cuadrilla guardado; '' si nunca se configuró uno. */
  teamCode: string | null;
  peerCount: number;
  lastReceivedSos: ReceivedSos | null;
  /** Compañeros de los que se tiene noticia (propia o relayada), sin incluirse a uno mismo. */
  teammates: TeammateStatus[];
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
 * Cada cuánto manda la app su propio "estoy activo", sin que el usuario
 * haga nada. Sirve para el caso en que alguien queda incapacitado y no
 * llega a apretar el SOS: la AUSENCIA de check-ins es la alarma, no el
 * check-in en sí.
 */
const CHECKIN_INTERVAL_MS = 15 * 60 * 1000;

/** Más de esto sin noticias de un compañero se marca como "sin novedades" en la UI. */
const OVERDUE_THRESHOLD_MS = 45 * 60 * 1000;

/** Cada cuánto se re-evalúa quién está overdue, aunque no haya llegado ningún mensaje nuevo (el reloj solo también es la señal). */
const OVERDUE_RECHECK_MS = 60 * 1000;

/**
 * Conecta la app al swarm P2P de la cuadrilla (si hay un código configurado)
 * y refleja localmente lo que llega de otros pares: alertas SOS, entradas
 * de bitácora, y check-ins de presencia. Ver `src/p2p/peerSync.ts` para el
 * transporte y `p2p/worklet.js` para lo que corre del lado Bare/Hyperswarm.
 *
 * Store-and-forward, no solo un salto: lo más común en el campo es que
 * nadie esté conectado en el instante exacto en que se genera un SOS, una
 * nota o un check-in — así que además de mandarlo a quien esté conectado
 * en ese momento, todo mensaje (propio o escuchado de otro peer) queda en
 * un "buzón" local (`relay_outbox` en SQLite) y se le pasa automáticamente
 * a la próxima persona que aparezca en rango, así nunca haya visto al que
 * lo originó.
 */
export function usePeerSync(onEntriesChanged?: () => void): PeerSyncState {
  const [teamCode, setTeamCodeState] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [lastReceivedSos, setLastReceivedSos] = useState<ReceivedSos | null>(null);
  const [teammates, setTeammates] = useState<TeammateStatus[]>([]);
  const startedRef = useRef(false);
  const teamCodeRef = useRef<string>('');
  const previousPeerCountRef = useRef(0);
  const deviceIdRef = useRef<string | null>(null);

  const refreshTeammates = useCallback(async () => {
    const rows = await getAllTeammateCheckins();
    const now = Date.now();
    setTeammates(
      rows
        .filter((row) => row.deviceId !== deviceIdRef.current)
        .map((row) => ({
          deviceId: row.deviceId,
          deviceName: row.deviceName,
          lastSeenAt: row.lastSeenAt,
          overdue: now - new Date(row.lastSeenAt).getTime() > OVERDUE_THRESHOLD_MS
        }))
    );
  }, []);

  const sendOwnCheckin = useCallback(async () => {
    const [deviceId, deviceName, location] = await Promise.all([
      getOrCreateDeviceId(),
      getDeviceName(),
      getCurrentGeoTag()
    ]);
    const sentAt = new Date().toISOString();
    const unsigned = {
      deviceId,
      deviceName,
      sentAt,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null
    };
    const payload: CheckinPayload = { ...unsigned, sig: await signCheckin(unsigned) };

    peerSync.broadcastCheckin(payload);
    await upsertTeammateCheckin(deviceId, deviceName, sentAt, location);
    const code = teamCodeRef.current;
    if (code) await upsertOutboxCheckin(outboxKeyForCheckin(deviceId), payload, code, sentAt);
    await refreshTeammates();
  }, [refreshTeammates]);

  const flushOutbox = useCallback(async () => {
    const code = teamCodeRef.current;
    if (!code) return;

    const items = await getOutboxItems(code, RELAY_TTL_MS);
    for (const item of items) {
      if (item.kind === 'sos') {
        peerSync.broadcastSos(item.payload as SosPayload);
      } else if (item.kind === 'entry') {
        peerSync.broadcastEntry(item.payload as EntryPayload);
      } else {
        peerSync.broadcastCheckin(item.payload as CheckinPayload);
      }
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    peerSync.start();
    void pruneOutbox(RELAY_TTL_MS);

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
      deviceIdRef.current = await getOrCreateDeviceId();
      await refreshTeammates();

      const savedCode = await getTeamCode();
      teamCodeRef.current = savedCode ?? '';
      setTeamCodeState(savedCode ?? '');
      if (savedCode) {
        await ensureBlePermissions();
        void peerSync.join(savedCode);
        void sendOwnCheckin();
      }
    })();

    const checkinTimer = setInterval(() => {
      if (teamCodeRef.current) void sendOwnCheckin();
    }, CHECKIN_INTERVAL_MS);
    const overdueTimer = setInterval(() => {
      void refreshTeammates();
    }, OVERDUE_RECHECK_MS);

    return () => {
      offPeerCount();
      offMessage();
      clearInterval(checkinTimer);
      clearInterval(overdueTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleIncomingMessage(event: PeerMessageEvent): Promise<void> {
    // Un mensaje propio que volvió rebotado por el buzón de otro peer — ya
    // lo tenemos, no es una alerta ni un check-in nuevo de nadie.
    if (event.payload.deviceId === deviceIdRef.current) return;

    const code = teamCodeRef.current;

    if (event.type === 'checkin') {
      const payload = event.payload;
      await upsertTeammateCheckin(
        payload.deviceId,
        payload.deviceName,
        payload.sentAt,
        payload.latitude != null && payload.longitude != null
          ? { latitude: payload.latitude, longitude: payload.longitude }
          : null
      );
      if (code) await upsertOutboxCheckin(outboxKeyForCheckin(payload.deviceId), payload, code, payload.sentAt);
      await refreshTeammates();
      return;
    }

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

  const setTeamCode = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      await persistTeamCode(trimmed);
      teamCodeRef.current = trimmed;
      setTeamCodeState(trimmed);
      peerSync.leave();
      if (trimmed) {
        await ensureBlePermissions();
        void peerSync.join(trimmed);
        void sendOwnCheckin();
      }
    },
    [sendOwnCheckin]
  );

  const broadcastNewEntry = useCallback(async (entry: LogEntry) => {
    if (entry.type !== 'nota' && entry.type !== 'checklist' && entry.type !== 'traduccion') return;
    const [deviceName, deviceId] = await Promise.all([getDeviceName(), getOrCreateDeviceId()]);

    const unsigned = {
      deviceId,
      deviceName,
      type: entry.type,
      text: entry.text,
      createdAt: entry.createdAt,
      latitude: entry.latitude,
      longitude: entry.longitude
    };
    const payload: EntryPayload = { ...unsigned, sig: await signEntry(unsigned) };

    peerSync.broadcastEntry(payload);
    const code = teamCodeRef.current;
    if (code) await addToOutbox(dedupKeyForEntry(payload), 'entry', payload, code);
  }, []);

  const relaySos = useCallback(async (payload: SosPayload) => {
    peerSync.broadcastSos(payload);
    const code = teamCodeRef.current;
    if (code) await addToOutbox(dedupKeyForSos(payload), 'sos', payload, code);
  }, []);

  return { teamCode, peerCount, lastReceivedSos, teammates, setTeamCode, broadcastNewEntry, relaySos };
}

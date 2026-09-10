import { z } from 'zod';

/**
 * Contrato entre React Native y el worklet Bare (p2p/worklet.js), sobre el
 * stream `worklet.IPC` usando `bare-rpc`. Los números de comando tienen que
 * coincidir EXACTO con las constantes `CMD_*`/`EVT_*` de `p2p/worklet.js` —
 * si cambiás uno, cambiá el otro.
 *
 * Todo lo que llega por acá viene de otro dispositivo en el swarm P2P — el
 * código de cuadrilla es la única puerta de entrada, no hay autenticación
 * criptográfica de identidad. Un par con el código puede mandar cualquier
 * `deviceName`/`text` que quiera, así que TODO payload entrante se valida
 * con zod (nunca se confía en la forma que dice tener) y se acota en
 * longitud antes de tocar la base de datos o la UI. Ver la sección
 * "Seguridad" del README para el detalle del modelo de confianza.
 */

// RN -> worklet
export const CMD_JOIN = 1;
export const CMD_LEAVE = 2;
export const CMD_BROADCAST = 3;

// worklet -> RN
export const EVT_PEER_COUNT = 10;
export const EVT_MESSAGE = 11;

const MAX_TEXT = 600;
const MAX_SHORT = 60;

const geoField = z.number().finite().nullable();

export const sosPayloadSchema = z.object({
  deviceId: z.string().max(MAX_SHORT),
  deviceName: z.string().max(MAX_SHORT),
  sentAt: z.string().max(MAX_SHORT),
  latitude: geoField,
  longitude: geoField
});

export const entryPayloadSchema = z.object({
  deviceId: z.string().max(MAX_SHORT),
  deviceName: z.string().max(MAX_SHORT),
  type: z.enum(['nota', 'traduccion', 'checklist']),
  text: z.string().max(MAX_TEXT),
  createdAt: z.string().max(MAX_SHORT),
  latitude: geoField,
  longitude: geoField
});

/**
 * "Estoy activo" — se manda solo, cada tanto, sin que el usuario haga
 * nada (ver `CHECKIN_INTERVAL_MS` en `usePeerSync.ts`). No es un evento
 * que haya que entregar una sola vez como el SOS o una nota: es estado
 * ("último visto de este dispositivo"), así que en `relay_outbox` un
 * check-in nuevo reemplaza al anterior del mismo dispositivo en vez de
 * acumularse — ver `upsertOutboxCheckin` en `src/services/database.ts`.
 */
export const checkinPayloadSchema = z.object({
  deviceId: z.string().max(MAX_SHORT),
  deviceName: z.string().max(MAX_SHORT),
  sentAt: z.string().max(MAX_SHORT),
  latitude: geoField,
  longitude: geoField
});

export const peerMessageEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sos'), payload: sosPayloadSchema, fromPeer: z.string().max(MAX_SHORT) }),
  z.object({ type: z.literal('entry'), payload: entryPayloadSchema, fromPeer: z.string().max(MAX_SHORT) }),
  z.object({ type: z.literal('checkin'), payload: checkinPayloadSchema, fromPeer: z.string().max(MAX_SHORT) })
]);

export type SosPayload = z.infer<typeof sosPayloadSchema>;
export type EntryPayload = z.infer<typeof entryPayloadSchema>;
export type CheckinPayload = z.infer<typeof checkinPayloadSchema>;
export type PeerMessageEvent = z.infer<typeof peerMessageEventSchema>;
export type PeerMessageType = PeerMessageEvent['type'];

export interface PeerCountEvent {
  count: number;
}

/**
 * Identidad estable de un mensaje P2P, usada tanto para no procesar el
 * mismo mensaje dos veces (`received_peer_messages`) como para no
 * relayarlo dos veces al mismo peer (`relay_outbox`) — ver
 * `src/services/database.ts`.
 */
export function dedupKeyForSos(payload: SosPayload): string {
  return `sos:${payload.deviceId}:${payload.sentAt}`;
}

export function dedupKeyForEntry(payload: EntryPayload): string {
  return `entry:${payload.deviceId}:${payload.createdAt}`;
}

/** Sin timestamp a propósito: un check-in nuevo del mismo dispositivo reemplaza al anterior, no se acumula. */
export function outboxKeyForCheckin(deviceId: string): string {
  return `checkin:${deviceId}`;
}

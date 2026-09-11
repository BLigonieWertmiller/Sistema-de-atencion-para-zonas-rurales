import nacl from 'tweetnacl';

import { signDeviceMessage } from '../services/identity';
import { base64ToBytes } from './base64';
import type { CheckinPayload, EntryPayload, SosPayload } from './protocol';

/**
 * Firma y verificación de los tres tipos de mensaje P2P (sos/entry/checkin).
 * El `deviceId` de un payload ES su clave pública ed25519 en base64 (ver
 * `src/services/identity.ts`), así que verificar la firma alcanza para
 * confirmar que el mensaje lo produjo quien tiene la clave privada
 * correspondiente — sin eso, cualquier par del swarm podría mandar un
 * check-in o un SOS "de parte de" cualquier otro `deviceId` que haya visto
 * circular, incluido el de un compañero real (por ejemplo, para simular que
 * está bien y tapar una ausencia real, o para gastar una alerta falsa en su
 * nombre).
 *
 * Se firma un string canónico con orden de campos fijado a mano (no el que
 * decida `JSON.stringify` de un objeto armado en otro orden), para que
 * quien firma y quien verifica calculen siempre exactamente los mismos
 * bytes.
 */

function canonicalSos(p: Omit<SosPayload, 'sig'>): string {
  return JSON.stringify({
    deviceId: p.deviceId,
    deviceName: p.deviceName,
    sentAt: p.sentAt,
    latitude: p.latitude,
    longitude: p.longitude
  });
}

function canonicalEntry(p: Omit<EntryPayload, 'sig'>): string {
  return JSON.stringify({
    deviceId: p.deviceId,
    deviceName: p.deviceName,
    type: p.type,
    text: p.text,
    createdAt: p.createdAt,
    latitude: p.latitude,
    longitude: p.longitude
  });
}

function canonicalCheckin(p: Omit<CheckinPayload, 'sig'>): string {
  return JSON.stringify({
    deviceId: p.deviceId,
    deviceName: p.deviceName,
    sentAt: p.sentAt,
    latitude: p.latitude,
    longitude: p.longitude
  });
}

/** UTF-8 propio en vez de `TextEncoder` — mismo criterio defensivo que `base64.ts` sobre no asumir globals de RN. */
function utf8ToBytes(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.codePointAt(i) as number;
    if (code > 0xffff) i++;

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return Uint8Array.from(bytes);
}

export async function signSos(payload: Omit<SosPayload, 'sig'>): Promise<string> {
  return signDeviceMessage(utf8ToBytes(canonicalSos(payload)));
}

export async function signEntry(payload: Omit<EntryPayload, 'sig'>): Promise<string> {
  return signDeviceMessage(utf8ToBytes(canonicalEntry(payload)));
}

export async function signCheckin(payload: Omit<CheckinPayload, 'sig'>): Promise<string> {
  return signDeviceMessage(utf8ToBytes(canonicalCheckin(payload)));
}

function verify(canonical: string, sigB64: string, deviceIdB64: string): boolean {
  try {
    const message = utf8ToBytes(canonical);
    const sig = base64ToBytes(sigB64);
    const publicKey = base64ToBytes(deviceIdB64);
    if (publicKey.length !== nacl.sign.publicKeyLength || sig.length !== nacl.sign.signatureLength) return false;
    return nacl.sign.detached.verify(message, sig, publicKey);
  } catch {
    return false;
  }
}

export function verifySos(payload: SosPayload): boolean {
  return verify(canonicalSos(payload), payload.sig, payload.deviceId);
}

export function verifyEntry(payload: EntryPayload): boolean {
  return verify(canonicalEntry(payload), payload.sig, payload.deviceId);
}

export function verifyCheckin(payload: CheckinPayload): boolean {
  return verify(canonicalCheckin(payload), payload.sig, payload.deviceId);
}

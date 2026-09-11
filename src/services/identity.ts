import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';

import { bytesToBase64, base64ToBytes } from '../p2p/base64';
import { getSetting, setSetting } from './database';

const KEY_SIGNING_SECRET = 'device_signing_secret_key';
const KEY_DEVICE_NAME = 'device_name';
const KEY_TEAM_CODE = 'team_code';

type SignKeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

let cachedKeyPair: SignKeyPair | null = null;

/**
 * Identidad criptográfica del dispositivo: un par de claves ed25519 que se
 * genera una sola vez y se persiste (la clave secreta nunca sale de este
 * dispositivo). Reemplaza a un UUID sin relación con nada — la clave
 * pública ES el `deviceId` (ver `getOrCreateDeviceId`), así que cualquier
 * mensaje que diga venir de un `deviceId` puede verificarse contra la firma
 * que lo acompaña (`src/p2p/signing.ts`), sin depender de ningún servidor
 * de identidad. Antes de esto, cualquier par en el swarm podía mandar un
 * check-in o un SOS con el `deviceId` de otra persona (por ejemplo, para
 * simular que un compañero real "está bien" y tapar una ausencia real) —
 * ver la sección "Seguridad" del README.
 */
async function getOrCreateKeyPair(): Promise<SignKeyPair> {
  if (cachedKeyPair) return cachedKeyPair;

  const existing = await getSetting(KEY_SIGNING_SECRET);
  if (existing) {
    cachedKeyPair = nacl.sign.keyPair.fromSecretKey(base64ToBytes(existing));
    return cachedKeyPair;
  }

  const seed = Crypto.getRandomBytes(32);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  await setSetting(KEY_SIGNING_SECRET, bytesToBase64(keyPair.secretKey));
  cachedKeyPair = keyPair;
  return keyPair;
}

/** Id P2P estable del dispositivo — es la clave pública ed25519, en base64. Nunca sale a ningún servidor. */
export async function getOrCreateDeviceId(): Promise<string> {
  const { publicKey } = await getOrCreateKeyPair();
  return bytesToBase64(publicKey);
}

/** Firma un mensaje ya codificado a bytes con la clave privada del dispositivo. Usado por `src/p2p/signing.ts`. */
export async function signDeviceMessage(message: Uint8Array): Promise<string> {
  const { secretKey } = await getOrCreateKeyPair();
  return bytesToBase64(nacl.sign.detached(message, secretKey));
}

export async function getDeviceName(): Promise<string> {
  return (await getSetting(KEY_DEVICE_NAME)) ?? 'Sin nombre';
}

export async function setDeviceName(name: string): Promise<void> {
  await setSetting(KEY_DEVICE_NAME, name.trim().slice(0, 40));
}

/** Código compartido por la cuadrilla — define a qué swarm P2P se unen (ver src/p2p/peerSync.ts). */
export async function getTeamCode(): Promise<string | null> {
  return getSetting(KEY_TEAM_CODE);
}

export async function setTeamCode(code: string): Promise<void> {
  await setSetting(KEY_TEAM_CODE, code.trim());
}

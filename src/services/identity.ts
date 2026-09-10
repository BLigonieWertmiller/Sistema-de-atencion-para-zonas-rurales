import * as Crypto from 'expo-crypto';

import { getSetting, setSetting } from './database';

const KEY_DEVICE_ID = 'device_id';
const KEY_DEVICE_NAME = 'device_name';
const KEY_TEAM_CODE = 'team_code';

/** Id local persistente del dispositivo — solo se usa para etiquetar mensajes P2P, nunca sale a ningún servidor. */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getSetting(KEY_DEVICE_ID);
  if (existing) return existing;

  const id = Crypto.randomUUID();
  await setSetting(KEY_DEVICE_ID, id);
  return id;
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

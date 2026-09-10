import * as SQLite from 'expo-sqlite';

import type { ChecklistItem, GeoTag, LogEntry, LogEntryType } from '../types';

const DB_NAME = 'agente_de_campo.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS log_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          latitude REAL,
          longitude REAL,
          metadata_json TEXT
        );
        CREATE TABLE IF NOT EXISTS checklist_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          label TEXT NOT NULL UNIQUE,
          done INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS received_peer_messages (
          dedup_key TEXT PRIMARY KEY,
          received_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS relay_outbox (
          dedup_key TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          team_code TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

export async function addLogEntry(
  type: LogEntryType,
  text: string,
  location: GeoTag | null,
  metadata?: Record<string, unknown>
): Promise<LogEntry> {
  const db = await getDb();
  const createdAt = new Date().toISOString();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  const result = await db.runAsync(
    'INSERT INTO log_entries (type, text, created_at, latitude, longitude, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
    type,
    text,
    createdAt,
    location?.latitude ?? null,
    location?.longitude ?? null,
    metadataJson
  );

  return {
    id: result.lastInsertRowId,
    type,
    text,
    createdAt,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    metadataJson
  };
}

export async function getTodayLogEntries(): Promise<LogEntry[]> {
  const db = await getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const rows = await db.getAllAsync<{
    id: number;
    type: LogEntryType;
    text: string;
    created_at: string;
    latitude: number | null;
    longitude: number | null;
    metadata_json: string | null;
  }>('SELECT * FROM log_entries WHERE created_at >= ? ORDER BY created_at ASC', startOfDay.toISOString());

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    text: row.text,
    createdAt: row.created_at,
    latitude: row.latitude,
    longitude: row.longitude,
    metadataJson: row.metadata_json
  }));
}

export async function upsertChecklistItem(
  label: string,
  done: boolean
): Promise<ChecklistItem> {
  const db = await getDb();
  const updatedAt = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO checklist_items (label, done, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(label) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at`,
    label,
    done ? 1 : 0,
    updatedAt
  );

  const row = await db.getFirstAsync<{ id: number; label: string; done: number; updated_at: string }>(
    'SELECT * FROM checklist_items WHERE label = ?',
    label
  );

  if (!row) {
    throw new Error(`No se pudo guardar el item de checklist "${label}"`);
  }

  return { id: row.id, label: row.label, done: row.done === 1, updatedAt: row.updated_at };
}

export async function getChecklistItems(): Promise<ChecklistItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; label: string; done: number; updated_at: string }>(
    'SELECT * FROM checklist_items ORDER BY updated_at DESC'
  );

  return rows.map((row) => ({ id: row.id, label: row.label, done: row.done === 1, updatedAt: row.updated_at }));
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}

/**
 * Dedup de mensajes recibidos por P2P: como el gossip entre pares es a un
 * solo salto y sin acuse de recibo, un mismo mensaje puede llegar más de
 * una vez (reconexión, reenvío). `dedupKey` identifica el mensaje de forma
 * estable (ver `src/p2p/*` para cómo se arma); esta tabla evita duplicar la
 * entrada de bitácora correspondiente.
 */
export async function wasAlreadyReceived(dedupKey: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT 1 FROM received_peer_messages WHERE dedup_key = ?', dedupKey);
  return row != null;
}

export async function markReceived(dedupKey: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR IGNORE INTO received_peer_messages (dedup_key, received_at) VALUES (?, ?)',
    dedupKey,
    new Date().toISOString()
  );
}

const OUTBOX_MAX_ROWS = 200;

/**
 * "Store-and-forward": un mensaje (propio o escuchado de otro peer) que
 * queda pendiente de pasarle a la próxima persona que aparezca en rango —
 * lo más común en el campo es que nadie esté conectado en el instante
 * exacto en que se genera un SOS o una nota. `dedupKey` es el mismo que
 * usa `received_peer_messages`, así que un mensaje nunca queda duplicado
 * acá aunque se reciba más de una vez.
 */
export async function addToOutbox(
  dedupKey: string,
  kind: 'sos' | 'entry',
  payload: unknown,
  teamCode: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR IGNORE INTO relay_outbox (dedup_key, kind, payload_json, team_code, created_at) VALUES (?, ?, ?, ?, ?)',
    dedupKey,
    kind,
    JSON.stringify(payload),
    teamCode,
    new Date().toISOString()
  );

  // Tope simple: si se pasa de OUTBOX_MAX_ROWS, se descartan los más viejos.
  // No es un ataque a mitigar tan estricto (los payloads ya están validados
  // y acotados en longitud antes de llegar acá) sino housekeeping normal.
  await db.runAsync(
    `DELETE FROM relay_outbox WHERE dedup_key IN (
       SELECT dedup_key FROM relay_outbox ORDER BY created_at DESC LIMIT -1 OFFSET ?
     )`,
    OUTBOX_MAX_ROWS
  );
}

export interface OutboxItem {
  dedupKey: string;
  kind: 'sos' | 'entry';
  payload: unknown;
}

/** Mensajes pendientes de pasar a otro peer, para el código de cuadrilla dado y no más viejos que `maxAgeMs`. */
export async function getOutboxItems(teamCode: string, maxAgeMs: number): Promise<OutboxItem[]> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

  const rows = await db.getAllAsync<{ dedup_key: string; kind: 'sos' | 'entry'; payload_json: string }>(
    'SELECT dedup_key, kind, payload_json FROM relay_outbox WHERE team_code = ? AND created_at >= ? ORDER BY created_at ASC',
    teamCode,
    cutoff
  );

  return rows.map((row) => ({ dedupKey: row.dedup_key, kind: row.kind, payload: JSON.parse(row.payload_json) }));
}

/** Housekeeping: se puede llamar al arrancar la app para no arrastrar mensajes de misiones viejas indefinidamente. */
export async function pruneOutbox(maxAgeMs: number): Promise<void> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  await db.runAsync('DELETE FROM relay_outbox WHERE created_at < ?', cutoff);
}

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

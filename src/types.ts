import type { IntentResult } from './agent/schema';

export type IntentName = IntentResult['intent'];

export interface GeoTag {
  latitude: number;
  longitude: number;
}

/** Intención ya clasificada (por el LLM on-device o por el fallback de reglas). */
export interface ClassifiedIntent extends IntentResult {
  /** 'llm' cuando vino del modelo on-device, 'reglas' cuando fue el fallback local. */
  source: 'llm' | 'reglas';
}

export type LogEntryType = 'nota' | 'traduccion' | 'checklist' | 'reporte' | 'sos';

export interface LogEntry {
  id: number;
  type: LogEntryType;
  text: string;
  createdAt: string; // ISO timestamp
  latitude: number | null;
  longitude: number | null;
  metadataJson: string | null;
}

export interface ChecklistItem {
  id: number;
  label: string;
  done: boolean;
  updatedAt: string;
}

export type AgentPhase =
  | 'inactivo'
  | 'escuchando'
  | 'transcribiendo'
  | 'pensando'
  | 'confirmando'
  | 'error';

import { useCallback, useEffect, useRef, useState } from 'react';

import { runIntentAction } from '../agent/actions';
import { classifyIntent } from '../agent/intentEngine';
import { MAX_TRANSCRIPT_LENGTH } from '../agent/sanitize';
import { AudioRecorder } from '../services/audioRecorder';
import { getTodayLogEntries } from '../services/database';
import { loadAgentModels, unloadAgentModels, type LoadedModels } from '../services/qvacModels';
import { transcribeAudioFile } from '../services/stt';
import { speakConfirmation } from '../services/tts';
import type { AgentPhase, LogEntry } from '../types';

export interface FieldAgentState {
  phase: AgentPhase;
  modelsReady: boolean;
  downloadLabel: string | null;
  downloadPercent: number | null;
  lastTranscript: string | null;
  lastConfirmation: string | null;
  errorMessage: string | null;
  todayEntries: LogEntry[];
  startRecording: () => Promise<void>;
  stopRecordingAndProcess: () => Promise<void>;
  refreshEntries: () => Promise<void>;
  generateReportNow: () => Promise<void>;
}

export function useFieldAgent(onEntryCreated?: (entry: LogEntry) => void): FieldAgentState {
  const [phase, setPhase] = useState<AgentPhase>('inactivo');
  const [modelsReady, setModelsReady] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastConfirmation, setLastConfirmation] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [todayEntries, setTodayEntries] = useState<LogEntry[]>([]);

  const modelsRef = useRef<LoadedModels | null>(null);
  const recorderRef = useRef(new AudioRecorder());

  const refreshEntries = useCallback(async () => {
    setTodayEntries(await getTodayLogEntries());
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const models = await loadAgentModels((label, progress) => {
          if (cancelled) return;
          setDownloadLabel(label);
          setDownloadPercent(progress.percentage);
        });
        if (cancelled) return;
        modelsRef.current = models;
        setModelsReady(true);
        setDownloadLabel(null);
      } catch (error) {
        if (cancelled) return;
        console.warn('No se pudieron cargar los modelos on-device, se usará el modo por reglas:', error);
        setErrorMessage('No se pudieron cargar los modelos on-device. La app sigue funcionando en modo básico.');
      }
    })();

    void refreshEntries();

    return () => {
      cancelled = true;
      const models = modelsRef.current;
      if (models) void unloadAgentModels(models);
    };
  }, [refreshEntries]);

  const startRecording = useCallback(async () => {
    setErrorMessage(null);
    const granted = await recorderRef.current.requestPermission();
    if (!granted) {
      setErrorMessage('Se necesita permiso de micrófono para registrar por voz.');
      setPhase('error');
      return;
    }
    await recorderRef.current.start();
    setPhase('escuchando');
  }, []);

  const stopRecordingAndProcess = useCallback(async () => {
    const audioUri = await recorderRef.current.stop();
    if (!audioUri) {
      setPhase('inactivo');
      return;
    }

    const models = modelsRef.current;

    try {
      setPhase('transcribiendo');
      const rawTranscript = models ? await transcribeAudioFile(models.sttModelId, audioUri) : '';
      const transcript = rawTranscript.trim().slice(0, MAX_TRANSCRIPT_LENGTH);

      if (!transcript) {
        setErrorMessage('No se entendió el audio, probá de nuevo.');
        setPhase('error');
        return;
      }
      setLastTranscript(transcript);

      setPhase('pensando');
      const intent = await classifyIntent(models?.llmModelId ?? null, transcript);
      const result = await runIntentAction(intent, models?.llmModelId ?? null);

      setLastConfirmation(result.confirmation);
      await refreshEntries();
      if (result.entry) onEntryCreated?.(result.entry);

      setPhase('confirmando');
      await speakConfirmation(models?.ttsModelId ?? null, result.confirmation);
      setPhase('inactivo');
    } catch (error) {
      console.warn('Error procesando el comando de voz:', error);
      setErrorMessage('Hubo un problema procesando el comando. Probá de nuevo.');
      setPhase('error');
    }
  }, [refreshEntries, onEntryCreated]);

  const generateReportNow = useCallback(async () => {
    try {
      const models = modelsRef.current;
      const result = await runIntentAction({ intent: 'generar_reporte', source: 'reglas' }, models?.llmModelId ?? null);
      setLastConfirmation(result.confirmation);
      await speakConfirmation(models?.ttsModelId ?? null, result.confirmation);
    } catch (error) {
      console.warn('Error generando el reporte:', error);
      setErrorMessage('No se pudo generar el reporte.');
    }
  }, []);

  return {
    phase,
    modelsReady,
    downloadLabel,
    downloadPercent,
    lastTranscript,
    lastConfirmation,
    errorMessage,
    todayEntries,
    startRecording,
    stopRecordingAndProcess,
    refreshEntries,
    generateReportNow
  };
}

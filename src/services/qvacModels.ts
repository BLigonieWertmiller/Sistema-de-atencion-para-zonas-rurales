import { loadModel, unloadModel, type ModelProgressUpdate } from '@qvac/sdk';

import { AGENT_LLM_MODEL, AGENT_STT_MODEL, AGENT_TTS_MODEL } from '../constants/models';

export interface LoadedModels {
  llmModelId: string;
  sttModelId: string;
  ttsModelId: string;
}

export type ModelDownloadListener = (label: string, progress: ModelProgressUpdate) => void;

/**
 * Descarga (la primera vez) y carga en memoria los tres modelos on-device
 * del agente. Todo lo que sigue después de esto —STT, clasificación de
 * intención, TTS— corre localmente en el dispositivo, sin red.
 */
export async function loadAgentModels(onProgress?: ModelDownloadListener): Promise<LoadedModels> {
  const llmModelId = await loadModel({
    modelSrc: AGENT_LLM_MODEL,
    modelConfig: { ctx_size: 4096 },
    onProgress: (p) => onProgress?.('llm', p)
  });

  const sttModelId = await loadModel({
    modelSrc: AGENT_STT_MODEL,
    modelConfig: { language: 'es', translate: false },
    onProgress: (p) => onProgress?.('stt', p)
  });

  const ttsModelId = await loadModel({
    modelSrc: AGENT_TTS_MODEL,
    modelConfig: { ttsEngine: 'supertonic', language: 'es', voice: 'F1' },
    onProgress: (p) => onProgress?.('tts', p)
  });

  return { llmModelId, sttModelId, ttsModelId };
}

export async function unloadAgentModels(models: LoadedModels): Promise<void> {
  await Promise.allSettled([
    unloadModel({ modelId: models.llmModelId }),
    unloadModel({ modelId: models.sttModelId }),
    unloadModel({ modelId: models.ttsModelId })
  ]);
}

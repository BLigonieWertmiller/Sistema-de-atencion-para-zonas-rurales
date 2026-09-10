/**
 * Modelos QVAC usados por el agente. Todos corren on-device (whisper.cpp /
 * llama.cpp / supertonic vía las adiciones nativas de @qvac/sdk) — ninguno
 * implica una llamada de red en tiempo de inferencia. La descarga inicial del
 * peso del modelo sí requiere red la primera vez (se cachea localmente
 * después), tal como cualquier app que empaqueta pesos on-device.
 */
import {
  LLAMA_3_2_1B_INST_Q4_0,
  WHISPER_SPANISH_TINY_Q8_0,
  TTS_MULTILINGUAL_SUPERTONIC3_Q8_0
} from '@qvac/sdk';

/** LLM chico que interpreta la intención del usuario y dispara acciones locales. */
export const AGENT_LLM_MODEL = LLAMA_3_2_1B_INST_Q4_0;

/** STT en español, afinado para reducir tamaño/latencia en dispositivos de campo. */
export const AGENT_STT_MODEL = WHISPER_SPANISH_TINY_Q8_0;

/** TTS multilingüe usado para la confirmación hablada (manos ocupadas). */
export const AGENT_TTS_MODEL = TTS_MULTILINGUAL_SUPERTONIC3_Q8_0;

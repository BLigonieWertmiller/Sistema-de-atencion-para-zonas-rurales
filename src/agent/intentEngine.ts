import { completion } from '@qvac/sdk';

import type { ClassifiedIntent } from '../types';
import { classifyByRules } from './rules';
import { AGENT_SYSTEM_PROMPT, INTENT_JSON_SCHEMA, intentResultSchema } from './schema';

/**
 * Interpreta la transcripción con el LLM chico corriendo on-device
 * (vía `completion` de @qvac/sdk) usando salida estructurada
 * (`responseFormat: json_schema`) para forzar que la respuesta sea
 * exactamente una de las 4 intenciones fijas del MVP, con sus argumentos.
 *
 * Si el LLM todavía no está cargado, o devuelve algo que no valida contra
 * el schema, se cae al clasificador por reglas (`classifyByRules`) para
 * que el loop nunca se trabe.
 */
export async function classifyIntent(
  llmModelId: string | null,
  transcript: string
): Promise<ClassifiedIntent> {
  if (!llmModelId) {
    return { ...classifyByRules(transcript), source: 'reglas' };
  }

  try {
    const run = completion({
      modelId: llmModelId,
      history: [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        { role: 'user', content: transcript }
      ],
      stream: false,
      responseFormat: {
        type: 'json_schema',
        json_schema: { name: 'intencion_agente', schema: INTENT_JSON_SCHEMA }
      }
    });

    const raw = await run.text;
    const parsed = intentResultSchema.parse(JSON.parse(raw.trim()));

    return { ...parsed, source: 'llm' };
  } catch (error) {
    console.warn('Clasificación con LLM on-device falló, usando reglas:', error);
    return { ...classifyByRules(transcript), source: 'reglas' };
  }
}

import { completion } from '@qvac/sdk';

import type { ClassifiedIntent } from '../types';
import { classifyByRules } from './rules';
import { sanitizeShortField, sanitizeText } from './sanitize';
import { AGENT_SYSTEM_PROMPT, INTENT_JSON_SCHEMA, intentResultSchema, type IntentResult } from './schema';

/**
 * Acota y limpia los campos de texto libre de una intención ya clasificada,
 * sea que haya venido del LLM o del fallback por reglas — ver
 * `sanitize.ts` para el porqué.
 */
function sanitizeIntentResult(result: IntentResult): IntentResult {
  return {
    ...result,
    texto: sanitizeText(result.texto),
    idioma_destino: sanitizeShortField(result.idioma_destino),
    item_checklist: sanitizeShortField(result.item_checklist)
  };
}

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
    return { ...sanitizeIntentResult(classifyByRules(transcript)), source: 'reglas' };
  }

  try {
    const run = completion({
      modelId: llmModelId,
      history: [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        // El transcript del usuario viaja como mensaje 'user' separado, nunca
        // interpolado dentro del system prompt, para que quede claro para el
        // modelo (y para cualquier lector del código) dónde termina la
        // instrucción y dónde empieza el dato no confiable.
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

    return { ...sanitizeIntentResult(parsed), source: 'llm' };
  } catch (error) {
    console.warn('Clasificación con LLM on-device falló, usando reglas:', error);
    return { ...sanitizeIntentResult(classifyByRules(transcript)), source: 'reglas' };
  }
}

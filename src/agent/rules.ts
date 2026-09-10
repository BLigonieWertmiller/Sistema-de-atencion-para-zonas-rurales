import type { IntentResult } from './schema';

const CHECKLIST_VERBS = ['marc', 'complet', 'termin', 'revis'];
const REPORT_KEYWORDS = ['reporte', 'informe', 'resumen del día', 'resumen del dia'];
const TRANSLATE_KEYWORDS = ['traduc', 'traducí', 'traduci', 'en portugués', 'en ingles', 'en inglés'];

const LANGUAGE_HINTS: Record<string, string> = {
  portugués: 'portugués',
  portugues: 'portugués',
  inglés: 'inglés',
  ingles: 'inglés',
  francés: 'francés',
  frances: 'francés'
};

/**
 * Clasificador de respaldo, sin modelo: por palabras clave en español.
 * Se usa cuando el LLM on-device todavía no cargó (p. ej. recién se abrió
 * la app y el modelo se está descargando) para que el loop nunca se
 * quede sin responder durante una demo o en el campo.
 */
export function classifyByRules(transcript: string): IntentResult {
  const lower = transcript.toLowerCase();

  if (REPORT_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { intent: 'generar_reporte' };
  }

  if (TRANSLATE_KEYWORDS.some((kw) => lower.includes(kw))) {
    const language = Object.keys(LANGUAGE_HINTS).find((hint) => lower.includes(hint));
    return {
      intent: 'traducir',
      texto: transcript,
      idioma_destino: language ? LANGUAGE_HINTS[language] : 'inglés'
    };
  }

  if (CHECKLIST_VERBS.some((kw) => lower.includes(kw))) {
    return {
      intent: 'marcar_checklist',
      item_checklist: transcript,
      estado_checklist: lower.includes('pendient') ? 'pendiente' : 'completo'
    };
  }

  return { intent: 'registrar_nota', texto: transcript };
}

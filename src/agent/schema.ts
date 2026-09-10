import { z } from 'zod';

/**
 * Las 4 intenciones fijas del MVP. El LLM on-device tiene que mapear
 * cualquier frase hablada a una de estas — esto es lo que convierte al
 * modelo en un agente que ejecuta acciones locales, no en un chatbot que
 * solo devuelve texto.
 */
export const INTENT_NAMES = ['registrar_nota', 'generar_reporte', 'traducir', 'marcar_checklist'] as const;

/** JSON Schema pasado a `completion({ responseFormat: { type: 'json_schema', ... } })`. */
export const INTENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENT_NAMES },
    texto: { type: 'string' },
    idioma_destino: { type: 'string' },
    item_checklist: { type: 'string' },
    estado_checklist: { type: 'string', enum: ['completo', 'pendiente'] }
  },
  required: ['intent'],
  additionalProperties: false
} as const;

export const intentResultSchema = z.object({
  intent: z.enum(INTENT_NAMES),
  texto: z.string().optional(),
  idioma_destino: z.string().optional(),
  item_checklist: z.string().optional(),
  estado_checklist: z.enum(['completo', 'pendiente']).optional()
});

export type IntentResult = z.infer<typeof intentResultSchema>;

export const AGENT_SYSTEM_PROMPT = `Sos el asistente de voz de un trabajador de campo (electricista, guardaparque, técnico agrícola). Tu única tarea es leer lo que el usuario dijo y devolver un JSON que indique qué acción ejecutar. No converses, no expliques, no agregues texto fuera del JSON.

Intenciones posibles:
- "registrar_nota": el usuario quiere dejar una nota o registro de algo que hizo u observó. Poné el texto completo de la nota en "texto".
- "generar_reporte": el usuario pide el resumen o reporte del día.
- "traducir": el usuario pide traducir una frase a otro idioma. Poné la frase original en "texto" y el idioma destino (en minúsculas, ej: "portugués", "inglés") en "idioma_destino".
- "marcar_checklist": el usuario marca un ítem de una checklist como hecho o pendiente. Poné el nombre del ítem en "item_checklist" y "completo" o "pendiente" en "estado_checklist".

Si la frase es ambigua, elegí la intención más probable igual — siempre tenés que devolver una.`;

/**
 * Saneamiento defensivo de los campos de texto libre que salen del LLM
 * (`texto`, `idioma_destino`, `item_checklist`) o del fallback por reglas,
 * antes de que lleguen a cualquier accion concreta (SQLite, `translate()`,
 * el reporte en PDF).
 *
 * El LLM nunca puede escapar del enum de intenciones fijas -- eso lo
 * garantiza la gramatica GBNF que genera `responseFormat: json_schema` a
 * nivel de token, no la buena voluntad del modelo -- pero estos campos si
 * son texto libre, asi que una frase adversarial en la voz del usuario
 * (prompt injection) todavia podria intentar inflar su longitud o inyectar
 * caracteres de control. Ninguno de estos campos controla codigo, SQL ni
 * rutas de archivo (todo eso esta parametrizado o hardcodeado), pero los
 * acotamos igual como defensa en profundidad.
 */

const MAX_TEXT_LENGTH = 600;
const MAX_SHORT_FIELD_LENGTH = 80;

// Caracteres de control ASCII (0x00-0x1F) y DEL (0x7F): sin uso legitimo en
// texto hablado transcripto, se reemplazan por espacio antes de colapsar.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

export function sanitizeText(value: string | undefined, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (!value) return value;
  return stripControlChars(value).slice(0, maxLength);
}

export function sanitizeShortField(value: string | undefined): string | undefined {
  return sanitizeText(value, MAX_SHORT_FIELD_LENGTH);
}

/** Tope aplicado a la transcripcion cruda antes de mandarla al LLM o guardarla. */
export const MAX_TRANSCRIPT_LENGTH = 1000;

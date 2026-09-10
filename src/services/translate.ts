import { translate } from '@qvac/sdk';

/**
 * Traduce texto reusando el mismo LLM chico ya cargado para clasificar
 * intenciones (`modelType: 'llamacpp-completion'` le dice a `translate` que
 * corra sobre un modelo de completion genérico en vez de requerir el motor
 * de traducción NMT dedicado) — así evitamos descargar un segundo modelo
 * solo para esta función.
 */
export async function translateText(
  llmModelId: string,
  text: string,
  targetLanguage: string
): Promise<string> {
  const result = translate({
    modelId: llmModelId,
    text,
    to: targetLanguage,
    modelType: 'llamacpp-completion',
    stream: false
  });

  return (await result.text).trim();
}

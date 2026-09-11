const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REVERSE_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE64_CHARS.length; i++) REVERSE_LOOKUP[BASE64_CHARS[i]] = i;

/**
 * Decodifica base64 a bytes sin depender del global `Buffer` (no garantizado
 * en RN) ni de `atob` (no disponible en todos los motores de JS de RN). Se
 * usa para materializar el bundle del worklet embebido como texto
 * (`workletBundle.generated.ts`) de vuelta a los bytes que espera
 * `Worklet.start()`.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[\r\n]/g, '');
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i += 4) {
    const c0 = REVERSE_LOOKUP[clean[i]] ?? 0;
    const c1 = REVERSE_LOOKUP[clean[i + 1]] ?? 0;
    const c2 = clean[i + 2] === '=' || clean[i + 2] === undefined ? undefined : REVERSE_LOOKUP[clean[i + 2]];
    const c3 = clean[i + 3] === '=' || clean[i + 3] === undefined ? undefined : REVERSE_LOOKUP[clean[i + 3]];

    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 !== undefined) bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
    if (c3 !== undefined) bytes.push(((c2 ?? 0) & 0x03) << 6 | c3);
  }

  return Uint8Array.from(bytes);
}

/** Codifica bytes a base64, sin depender de `Buffer`/`btoa` — ver `base64ToBytes`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;

    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    result += hasB1 ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    result += hasB2 ? BASE64_CHARS[b2 & 0x3f] : '=';
  }
  return result;
}

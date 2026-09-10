/** `b4a` no publica tipos; se declara acá el subconjunto mínimo que usamos. */
declare module 'b4a' {
  function toString(buffer: unknown, encoding?: string): string;
  function from(input: unknown, encoding?: string): Uint8Array;
  const _default: { toString: typeof toString; from: typeof from };
  export default _default;
}

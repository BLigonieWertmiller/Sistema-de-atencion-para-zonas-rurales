#!/usr/bin/env node
/**
 * Empaqueta p2p/worklet.js (el código que corre dentro del runtime Bare)
 * con `bare-pack`, resolviendo los addons nativos (udx-native, sodium-native)
 * como `linked:` para los hosts móviles soportados, y lo embebe como base64
 * en un archivo TS generado que el bundle de Metro puede importar como
 * cualquier otro módulo — así evitamos depender de que Metro sepa cargar un
 * asset binario custom.
 *
 * Se corre una vez después de `npm install` (ya versionado en git, no hace
 * falta correrlo para levantar la app) y de nuevo cada vez que cambie
 * `p2p/worklet.js` o sus dependencias.
 *
 * Verificado a mano en este repo: `npx bare-pack --linked --host
 * android-arm64 --host android-arm --host android-x64 --host ios-arm64
 * --host ios-arm64-simulator p2p/worklet.js` resuelve el grafo completo
 * (hyperswarm, hyperdht, bare-rpc, b4a) y encuentra binarios `linked:` reales
 * para udx-native y sodium-native en los 5 hosts. `node
 * node_modules/react-native-bare-kit/android/link.mjs` y el equivalente de
 * ios/ copian esos binarios al proyecto nativo sin errores.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY = path.join(ROOT, 'p2p', 'worklet.js');
const OUT_FILE = path.join(ROOT, 'src', 'p2p', 'workletBundle.generated.ts');

const HOSTS = ['android-arm64', 'android-arm', 'android-x64', 'ios-arm64', 'ios-arm64-simulator'];

const tmpDir = mkdtempSync(path.join(tmpdir(), 'agente-worklet-'));
const bundlePath = path.join(tmpDir, 'worklet.bundle');

try {
  const args = ['bare-pack', '--linked'];
  for (const host of HOSTS) args.push('--host', host);
  args.push('-o', bundlePath, ENTRY);

  execFileSync('npx', args, { stdio: 'inherit', cwd: ROOT });

  const bundleBytes = readFileSync(bundlePath);
  const base64 = bundleBytes.toString('base64');

  const header = `// GENERADO por scripts/build-worklet.mjs a partir de p2p/worklet.js — no editar a mano.\n// Volver a correr \`npm run build:worklet\` después de tocar p2p/worklet.js.\n`;
  const body = `${header}export const WORKLET_BUNDLE_BASE64 = ${JSON.stringify(base64)};\n`;

  writeFileSync(OUT_FILE, body);
  console.log(`Bundle del worklet escrito en ${path.relative(ROOT, OUT_FILE)} (${bundleBytes.length} bytes -> ${base64.length} chars base64)`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

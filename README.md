# Agente de Campo Offline

App móvil (Expo / React Native) para trabajadores de campo — inspectores de
líneas eléctricas, guardaparques, técnicos agrícolas, guías de montaña — que
necesitan registrar información y ejecutar acciones durante su jornada en
zonas sin señal, donde cualquier app dependiente de la nube simplemente no
funciona.

Este proyecto nace como propuesta para el **Decentralized AI Hackathon
(QVAC)**: toda la inferencia corre **on-device**, usando
[`@qvac/sdk`](https://qvac.tether.io) — nunca en la nube.

## El problema

Un trabajador de campo necesita, con las manos ocupadas y sin señal:

1. Dejar una nota de voz sobre lo que hizo o encontró.
2. Generar el reporte del día para entregar cuando vuelva a tener conexión.
3. Traducir una frase para comunicarse con un proveedor o colega.
4. Marcar un ítem de una checklist como revisado.
5. Pedir ayuda si algo sale mal — sin señal celular, sin depender de que alguien esté mirando el chat.

**Por qué la nube no es una opción acá:** conectividad intermitente y zonas
sin señal son la norma en este tipo de trabajo, no la excepción. Una app que
depende de una API en la nube para transcribir voz o interpretar una orden
simplemente deja de funcionar en el momento exacto en que más se la necesita.

## Loop núcleo del agente

```
voz del usuario
   │
   ▼
STT on-device (Whisper, @qvac/sdk)            → texto
   │
   ▼
LLM chico on-device (Llama 3.2 1B, @qvac/sdk) → interpreta la intención
   │   y devuelve JSON estructurado (responseFormat: json_schema)
   ▼
Acción local concreta:
   - registrar_nota      → SQLite (con timestamp + ubicación)
   - generar_reporte      → texto plano + PDF, listo para compartir
   - traducir             → LLM on-device (translate) + SQLite
   - marcar_checklist     → SQLite
   │
   ▼
TTS on-device (Supertonic, @qvac/sdk) → confirmación hablada, sin mirar la pantalla
```

Lo que hace a esto un **agente** y no un chatbot: el modelo no devuelve texto
para que el usuario lo lea, devuelve una intención estructurada que la app
ejecuta como acción real sobre el dispositivo (escribir en la base de datos
local, generar un archivo, disparar una traducción).

## Dónde ocurre exactamente la inferencia

| Paso | Modelo | Motor | Dónde |
|---|---|---|---|
| Voz → texto | `WHISPER_SPANISH_TINY_Q8_0` | whisper.cpp (`@qvac/asr-ggml`) | on-device |
| Intención → JSON | `LLAMA_3_2_1B_INST_Q4_0` | llama.cpp (`@qvac/llm-llamacpp`) | on-device |
| Traducción | mismo LLM de arriba, vía `translate()` | llama.cpp | on-device |
| Confirmación hablada | `TTS_MULTILINGUAL_SUPERTONIC3_Q8_0` | Supertonic (`@qvac/tts-ggml`) | on-device |

Los tres modelos se cargan con `loadModel()` de `@qvac/sdk` al abrir la app
(`src/services/qvacModels.ts`) y quedan residentes en memoria durante la
sesión. La única vez que se toca la red es para **descargar el peso del
modelo la primera vez** (se cachea localmente después) — igual que cualquier
app que empaqueta modelos on-device. Ninguna llamada de inferencia sale a una
API en la nube; podés verificarlo cortando el wifi/datos del teléfono después
de la primera carga y usando la app con normalidad.

Todo el resto (SQLite, ubicación, generación de PDF, UI) es lógica de app
corriendo localmente, sin ningún componente de red.

## P2P entre pares (Pears) y botón de SOS

El bonus del hackathon — "donde la nube no debería llegar" llevado al
extremo — es que la cuadrilla se sincronice entre sí sin ningún servidor de
por medio, ni siquiera para el caso más urgente: pedir ayuda.

```
Peer A ──┐                                              ┌── Peer B
         │  Hyperswarm (HyperDHT)  — necesita algo de red │
         │  ble-swarm (Bluetooth LE) — cero red, ~10-30m  │
         └──────────────────── swarm P2P ─────────────────┘
              topic = SHA-256("<código de cuadrilla>")

  botón SOS ──► buzón local (relay_outbox) ──► worklet Bare ──► worklet Bare ──► alerta en pantalla + voz
  nota de voz ─┘        │                                                    └─ bitácora del compañero
                         └─ se le vuelve a pasar al próximo par que aparezca, hasta 72hs, aunque no haya visto al que lo originó
```

- **Identificación del equipo:** todos los que cargan el mismo "código de
  cuadrilla" (pantalla Bitácora) se unen al mismo *topic* — un hash SHA-256
  del código, nunca el código en texto plano viaja por la red — en **ambos
  transportes a la vez**.
- **Dos transportes, en paralelo, mismo protocolo:** Hyperswarm (HyperDHT)
  para cuando hay algún camino de red (wifi local, o una ventana breve de
  señal), y `ble-swarm` (Bluetooth LE, sobre `bare-bluetooth`) para el caso
  límite real de "cero red compartida" — dos radios BLE viéndose
  directamente, sin wifi ni datos de por medio. Los dos emiten el mismo tipo
  de conexión cifrada (`NoiseSecretStream`), así que el resto del código
  (gossip, dedup, UI) no distingue por qué radio llegó un mensaje.
- **Qué se sincroniza:** notas, ítems de checklist y traducciones que cada
  uno generó, más las alertas SOS.
- **Store-and-forward, no solo un salto.** Lo más probable en el campo es
  que nadie esté conectado en el instante exacto en que se aprieta el SOS
  o se registra una nota. Por eso todo mensaje —propio, o escuchado de
  otro peer— queda en un buzón local (`relay_outbox` en SQLite) y se le
  vuelve a pasar automáticamente a la próxima persona que aparezca en
  rango, aunque nunca haya visto al que lo originó. Así una alerta puede
  viajar de mano en mano por la cuadrilla sin que dos personas hayan
  estado nunca conectadas directamente. Cada mensaje se relaya hasta 72hs
  desde que se originó (después de eso deja de propagarse, pero sigue en
  la bitácora local del que lo tenía). El dedup por `(deviceId,
  timestamp)` evita que se muestre o se guarde dos veces, sin importar por
  cuántas manos haya pasado.
- **Botón de SOS:** deliberadamente separado del flujo de voz — en una
  emergencia real no hay que depender de que un LLM interprete bien una
  frase dicha bajo estrés. Mantener presionado ~2s (como el SOS de un
  celular) captura ubicación + hora, lo guarda localmente, lo manda por
  **los dos transportes** a cualquier par conectado ahora mismo, y lo deja
  en el buzón para los que aparezcan después. Si no hay pares conectados
  en el momento del botón, la confirmación lo dice explícitamente ("Sin
  pares conectados ahora — se manda sola apenas aparezca uno") — nunca
  finge haber avisado a alguien si no lo hizo.
- **Check-in automático ("estoy activo"):** el SOS cubre "algo salió mal y
  llegué a apretar el botón" — pero el caso más preocupante es el otro:
  alguien queda incapacitado y *no* llega a apretar nada. Por eso cada
  dispositivo manda solo, cada 15 minutos mientras está unido a una
  cuadrilla, una señal de presencia con su ubicación. Si hace más de 45
  minutos que no se sabe nada de un compañero, la pantalla Bitácora lo
  marca como "sin novedades" — la ausencia misma es la alarma, se detecta
  aunque esa persona nunca haya tocado el teléfono. Corre por el mismo
  buzón de store-and-forward: no hace falta haber visto a esa persona
  directamente, alcanza con que alguien que sí la vio te pase la posta.
- **Sin servidor, en ningún punto.** El descubrimiento de pares usa la DHT
  pública de Hyperswarm/Pear (o bootstrap propio en red local) o el radio
  BLE directamente; una vez conectados, el enlace es directo entre los dos
  dispositivos.

### Cómo corre técnicamente (Bare, no React Native puro)

`react-native-bare-kit` embebe un runtime **Bare** dentro de la app — el
mismo runtime que usa `@qvac/sdk` para su propio motor de inferencia, así
que la app ya traía esta pieza. Ni Hyperswarm ni `ble-swarm` corren en el
hilo de JS de React Native (no pueden: sus dependencias nativas —
`udx-native` para UDP, `sodium-native` para criptografía, `bare-bluetooth`
para BLE central/periférico — no son módulos de React Native), corren
dentro de ese runtime Bare, en `p2p/worklet.js`.

```
p2p/worklet.js  (Hyperswarm + ble-swarm, corren juntos en Bare)
      │  bare-pack --linked --host android-* --host ios-*
      ▼
src/p2p/workletBundle.generated.ts   (bundle embebido en base64, ya versionado)
      │  Worklet.start('/app.bundle', bytes)   (react-native-bare-kit)
      ▼
src/p2p/peerSync.ts  (puente RN ⇄ worklet, por bare-rpc sobre worklet.IPC)
      ▼
src/hooks/usePeerSync.ts  (valida con zod, escribe en SQLite, actualiza la UI)
```

**Esto no quedó en el papel: se verificó en este repo.** Se instalaron de
verdad `hyperswarm`, `ble-swarm`, `hypercore-crypto`, `bare-rpc`,
`react-native-bare-kit`, `bare-pack` y `bare-link`, y se corrió el pipeline
completo:

```bash
npx bare-pack --linked \
  --host android-arm64 --host android-arm --host android-x64 \
  --host ios-arm64 --host ios-arm64-simulator \
  -o worklet.bundle p2p/worklet.js
# ✔ resuelve todo el grafo de módulos (hyperswarm, hyperdht, ble-swarm,
#   bare-bluetooth, hypercore-crypto, bare-rpc, b4a)
# ✔ encuentra binarios linked: reales para udx-native, sodium-native,
#   bare-bluetooth-android y bare-bluetooth-apple en los 5 hosts
#   (Android arm64/arm/x64, iOS device + simulador)

node node_modules/react-native-bare-kit/android/link.mjs
node node_modules/react-native-bare-kit/ios/link.mjs
# ✔ copia esos binarios (.so por ABI, .jar/.dex de Android para BLE,
#   .xcframework de iOS) al proyecto nativo, sin errores
```

Lo único que **no** se pudo verificar en este entorno (sandbox sin
Android/iOS SDK ni dispositivo) es la compilación nativa final y el
descubrimiento de peers real —por wifi/DHT o por Bluetooth—. `npm run
build:worklet` ya corrió y el bundle resultante está commiteado en
`src/p2p/workletBundle.generated.ts`, así que no hace falta tener
`bare-pack` instalado para levantar la app — solo si se edita
`p2p/worklet.js`.

### Qué cubre cada transporte

| | Hyperswarm (HyperDHT) | `ble-swarm` (Bluetooth LE) |
|---|---|---|
| Requiere | Algún camino de red (wifi local o una ventana breve de señal) | Nada — dos radios BLE viéndose |
| Alcance | El de esa red (LAN completa, o internet si hay bootstrap) | Line-of-sight, ~10-30m típico |
| Velocidad | Rápida, sin límite práctico para estos mensajes | Más lenta (BLE), de sobra para JSON chico |
| Estado upstream | Estable, en producción en el ecosistema Pear | Marcado `experimental` por Holepunch |

Ambos se intentan siempre en paralelo — si uno no encuentra pares, el otro
puede igual. Si el hardware no tiene BLE o la plataforma no está soportada
(`bare-bluetooth` cubre macOS 13+, iOS y Android), `ble-swarm` reporta
`unsupported` y sigue sin romper nada; Hyperswarm sigue funcionando igual.

### Limitación honesta sobre "sin señal"

Con **solo** Hyperswarm, dos teléfonos sin wifi compartido y sin datos no
se hubieran encontrado — por eso se sumó `ble-swarm`, que sí cubre ese caso
límite (cero red, Bluetooth directo). Lo que queda como limitación real:

- El alcance de BLE es mucho más corto que el de una red wifi (decenas de
  metros, no todo el predio).
- `ble-swarm` está marcado `experimental` por sus propios autores (Holepunch)
  — la API puede cambiar, y no se probó en hardware real en este entorno.
- El relay (store-and-forward) solo avanza cuando alguien enciende la app
  y se cruza en rango con otro par — no hay reenvío en segundo plano si la
  app está cerrada, y en iOS en particular el escaneo BLE en background
  está muy restringido por el sistema operativo. En la práctica, esto
  significa que la app tiene que estar abierta (pantalla prendida o al
  menos en primer plano) para que el relay funcione de manera confiable.

## Seguridad

Auditoría hecha sobre el código de este repo (no solo diseño en el papel).
Puntos revisados y su estado:

- **Ninguna API expuesta.** La app no levanta ningún servidor, socket ni
  endpoint HTTP; no hay `fetch`/`XMLHttpRequest`/`axios`/WebSocket en todo
  `src/` (verificado por grep, no queda ningún resultado). El único tráfico
  de red posible en toda la app es el que hace `@qvac/sdk` internamente para
  descargar el *peso* de un modelo la primera vez — nunca para ejecutar una
  inferencia. El permiso `INTERNET` que trae cualquier proyecto React
  Native por plantilla no equivale a tener una API expuesta: nadie puede
  conectarse *hacia* el dispositivo, la app solo podría —si quisiera—
  conectarse hacia afuera, y no lo hace en ningún camino de código.
- **Resistencia a prompt injection en el agente.** El campo `intent` de la
  salida del LLM está restringido por gramática (`responseFormat:
  json_schema` se compila a GBNF en llama.cpp) a los 4 valores fijos — esto
  se aplica a nivel de token durante la generación, no depende de que el
  modelo "obedezca": no hay ninguna secuencia de texto hablado que pueda
  hacerlo devolver una intención fuera de esa lista o salirse del JSON.
  Además, el system prompt (`src/agent/schema.ts`) le indica explícitamente
  al modelo que la transcripción del usuario es un dato a clasificar, nunca
  una instrucción, como defensa en profundidad adicional. Los campos de
  texto libre que sí puede llenar el modelo (`texto`, `idioma_destino`,
  `item_checklist`) se sanean y acotan en longitud
  (`src/agent/sanitize.ts`) antes de tocar cualquier acción — y ninguno de
  esos campos controla código, SQL ni rutas de archivo, así que el peor
  resultado posible de una frase adversarial es un registro con texto raro,
  no una acción no autorizada.
- **Sin inyección SQL.** Todas las consultas a SQLite
  (`src/services/database.ts`) usan parámetros con `?`, nunca concatenación
  de texto del usuario dentro del SQL.
- **Sin inyección HTML/XSS en el reporte.** El texto del reporte se escapa
  (`escapeHtml` en `src/services/report.ts`) antes de insertarse en el HTML
  que `expo-print` convierte a PDF, así que una nota con `<script>` u otro
  markup no puede alterar el documento generado.
- **Datos locales por defecto.** La bitácora vive en SQLite en el
  dispositivo y la ubicación se usa solo para geoetiquetar cada registro;
  nada de eso sale del teléfono salvo que el usuario comparta explícitamente
  el PDF del reporte con el botón de compartir (acción manual del usuario,
  no automática de la app).
- **Permisos mínimos, todos justificados.** Micrófono (STT), ubicación en
  primer plano (`WhenInUse`, no `Always`/background, para geoetiquetar), y
  Bluetooth/red local (para el swarm P2P con la cuadrilla). Ninguno se pide
  para telemetría ni para nada que no esté descrito en este README.
- **Sin secretos ni credenciales en el repo.** No hay API keys, tokens ni
  URLs de servicios propios hardcodeadas en el código (verificado por grep).
- **Modelo de confianza del P2P (Pears).** El código de cuadrilla es la
  única puerta de entrada al swarm — nunca viaja en texto plano (se manda un
  hash SHA-256 como *topic*), pero no hay autenticación criptográfica de
  identidad entre pares: cualquiera con el código puede unirse y mandar
  mensajes con cualquier `deviceName`. Por diseño, esto se trata como
  entrada no confiable: todo mensaje recibido de un par se valida con zod
  contra un schema estricto (`src/p2p/protocol.ts`, tipos y longitudes
  acotadas) *antes* de tocar la base de datos o la UI — un payload que no
  matchea se descarta y se loguea, nunca se guarda a medias. El peor caso de
  un código de cuadrilla filtrado es que alguien vea o falsifique
  notas/alertas de esa cuadrilla, no ejecución de código ni acceso a otros
  datos del dispositivo. Recomendación operativa: tratar el código como una
  contraseña compartida y rotarlo por turno o misión.
- **El buzón de relay (`relay_outbox`) no abre superficie nueva.** Lo que
  se relaya ya pasó por la validación zod al recibirlo (se guarda el
  objeto ya validado, no bytes crudos de un peer) y por el saneamiento de
  longitud de `src/agent/sanitize.ts` en su origen — relayarlo no ejecuta
  nada nuevo ni revalida menos que guardarlo. Para acotar el caso de un
  peer que intente inundar la red con mensajes falsos para que se
  propaguen más lejos: el buzón tiene un tope de 200 mensajes por
  dispositivo y un TTL de 72hs, así que la amplificación tiene un techo
  fijo, no crece sin límite.

## Base preexistente utilizada (declarado explícitamente)

Este proyecto se armó desde cero para el hackathon, sobre las siguientes
librerías de terceros (todas open source, ninguna es código propio de un
proyecto anterior):

- **Expo SDK 54** + React Native — framework de la app.
- **`@qvac/sdk`** — inferencia on-device (STT, LLM, TTS, traducción).
- **`zod`** — validación de la salida estructurada del LLM.
- **`expo-av`** — grabación de audio del micrófono.
- **`expo-sqlite`** — almacenamiento local estructurado (bitácora + checklist).
- **`expo-location`** — geoetiquetado de cada registro.
- **`expo-print` / `expo-sharing`** — generación y envío del reporte en PDF.
- **`expo-speech`** — voz del sistema como respaldo si el modelo TTS on-device
  todavía no terminó de cargar (para que la confirmación hablada nunca falle
  en una demo).
- **`expo-haptics`** — feedback táctil del botón de SOS.
- **`expo-crypto`** — hash SHA-256 del código de cuadrilla → *topic* de Hyperswarm.
- **Pear / Holepunch stack** — `react-native-bare-kit` (runtime Bare
  embebido), `hyperswarm` + `ble-swarm` + `hypercore-crypto` + `bare-rpc` +
  `b4a` (los dos transportes P2P y el protocolo con el worklet), `bare-pack`
  + `bare-link` (empaquetado y linkeo nativo de esos módulos, incluido BLE,
  para Android/iOS) — ver la sección de P2P más arriba.

## Cómo correrlo

`@qvac/sdk` usa módulos nativos (llama.cpp / whisper.cpp compilados vía
`react-native-bare-kit`), así que **no funciona en Expo Go** — hace falta un
*development build*.

```bash
npm install

# linkea los binarios nativos de Hyperswarm (udx-native, sodium-native) al
# proyecto de react-native-bare-kit — correrlo de nuevo si cambian esas deps
npm run link:bare

# genera los proyectos nativos ios/ y android/
npx expo prebuild

# Android (requiere Android Studio / SDK instalado)
npx expo run:android

# iOS (requiere Xcode, solo macOS)
npx expo run:ios
```

Si se edita `p2p/worklet.js` (el código P2P que corre en Bare), hay que
regenerar el bundle embebido antes de recompilar:

```bash
npm run build:worklet
```

La primera vez que se usa cada función (STT, LLM, TTS) la app descarga el
peso del modelo correspondiente desde el registro de QVAC y lo cachea en el
dispositivo — con buena señal, conviene abrir la app una vez conectado antes
de salir a campo. Después de eso, funciona completamente offline.

### Probar el loop sin hablar

Además del botón de micrófono en la pantalla principal, la pestaña
**Bitácora** tiene un botón "Generar reporte del día" que dispara la misma
acción sin pasar por voz — útil para verificar rápido que el resto del
pipeline (SQLite → reporte → PDF) funciona.

## Estructura del código

```
p2p/worklet.js             Código P2P (Hyperswarm + ble-swarm) que corre en el runtime Bare
scripts/build-worklet.mjs  Empaqueta p2p/worklet.js con bare-pack -> bundle embebido

src/
  constants/models.ts    Modelos QVAC usados (LLM, STT, TTS)
  agent/
    schema.ts             Las 4 intenciones fijas + JSON Schema para el LLM
    intentEngine.ts        Clasificación de intención con el LLM on-device
    rules.ts                Fallback por palabras clave (sin modelo)
    actions.ts               Ejecuta la acción concreta de cada intención
    sanitize.ts               Saneamiento de texto libre (defensa en profundidad)
  services/
    qvacModels.ts          Carga/descarga de los 3 modelos on-device
    audioRecorder.ts        Grabación de voz (expo-av)
    stt.ts                    Transcripción (Whisper on-device)
    tts.ts                     Confirmación hablada (Supertonic on-device + fallback)
    translate.ts               Traducción (reusa el LLM ya cargado)
    database.ts                Bitácora, checklist, settings, dedup y relay_outbox/check-ins P2P en SQLite
    location.ts                Geoetiquetado
    report.ts                    Reporte del día (texto + PDF)
    identity.ts                   Id de dispositivo, nombre y código de cuadrilla
  p2p/
    protocol.ts             Contrato RN ⇄ worklet + schemas zod de validación
    peerSync.ts               Puente RN ⇄ worklet Bare (bare-rpc sobre worklet.IPC)
    blePermissions.ts           Permisos de runtime de Bluetooth (Android 12+)
    workletBundle.generated.ts    Bundle de p2p/worklet.js embebido (generado, versionado)
  hooks/
    useFieldAgent.ts        Orquesta el loop de voz completo (estado de la UI)
    usePeerSync.ts            Conecta al swarm, valida y refleja lo que llega de pares
  screens/, components/    UI voice-first, minimalista (incluye SosButton)
```

## Limitaciones conocidas (MVP de 48hs)

- Las 4 intenciones de voz son fijas (registrar nota, generar reporte,
  traducir, marcar checklist) — no hay conversación libre ni intenciones
  nuevas sin tocar código. El SOS es una quinta acción, pero deliberadamente
  fuera del flujo de voz/LLM.
- La sincronización P2P es a un solo salto (entre pares conectados
  directamente, sea por wifi/DHT o por Bluetooth), no una red mesh
  multi-salto — ver "Limitación honesta sobre sin señal" más arriba.
- `ble-swarm`, el transporte Bluetooth para el caso de cero red compartida,
  está marcado `experimental` por sus propios autores (Holepunch); el
  alcance real de BLE es corto (~10-30m).
- No hay autenticación criptográfica de identidad entre pares del swarm más
  allá de compartir el código de cuadrilla — ver la nota de seguridad
  correspondiente.
- No se probó en un dispositivo físico dentro de este entorno de desarrollo
  (sandbox sin Android/iOS SDK, sin emulador, sin micrófono, sin radio BLE).
  Lo que sí se verificó a mano en este repo: `tsc --noEmit` limpio contra
  los tipos reales de `@qvac/sdk` 0.19.0 y del stack de Pear/Holepunch, y el
  pipeline completo de `bare-pack --linked` + `bare-link` corriendo de
  punta a punta para ambos transportes P2P (ver la sección correspondiente).
  Falta la compilación nativa final y la prueba de descubrimiento de pares
  en hardware real antes del hackathon.

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
- **Permisos mínimos.** Solo se piden micrófono y ubicación en primer plano
  (`WhenInUse`, no `Always`/background). No se pide ni se usa ningún permiso
  adicional.
- **Sin secretos ni credenciales en el repo.** No hay API keys, tokens ni
  URLs de servicios propios hardcodeadas en el código (verificado por grep).

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

## Cómo correrlo

`@qvac/sdk` usa módulos nativos (llama.cpp / whisper.cpp compilados vía
`react-native-bare-kit`), así que **no funciona en Expo Go** — hace falta un
*development build*.

```bash
npm install

# genera los proyectos nativos ios/ y android/
npx expo prebuild

# Android (requiere Android Studio / SDK instalado)
npx expo run:android

# iOS (requiere Xcode, solo macOS)
npx expo run:ios
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
src/
  constants/models.ts    Modelos QVAC usados (LLM, STT, TTS)
  agent/
    schema.ts             Las 4 intenciones fijas + JSON Schema para el LLM
    intentEngine.ts        Clasificación de intención con el LLM on-device
    rules.ts                Fallback por palabras clave (sin modelo)
    actions.ts               Ejecuta la acción concreta de cada intención
  services/
    qvacModels.ts          Carga/descarga de los 3 modelos on-device
    audioRecorder.ts        Grabación de voz (expo-av)
    stt.ts                    Transcripción (Whisper on-device)
    tts.ts                     Confirmación hablada (Supertonic on-device + fallback)
    translate.ts               Traducción (reusa el LLM ya cargado)
    database.ts                Bitácora y checklist en SQLite
    location.ts                Geoetiquetado
    report.ts                    Reporte del día (texto + PDF)
  hooks/useFieldAgent.ts   Orquesta el loop completo (estado de la UI)
  screens/, components/    UI voice-first, minimalista
```

## Limitaciones conocidas (MVP de 48hs)

- Las 4 intenciones son fijas (registrar nota, generar reporte, traducir,
  marcar checklist) — no hay conversación libre ni intenciones nuevas sin
  tocar código.
- El bonus de sincronización P2P entre pares (Pears) descrito en la
  propuesta original no está implementado en este MVP; queda como próximo
  paso si el proyecto avanza más allá del hackathon.
- No se probó en un dispositivo físico dentro de este entorno de desarrollo
  (sandbox sin build nativo ni micrófono); el código fue validado contra los
  tipos y ejemplos oficiales de `@qvac/sdk` 0.19.0 (`tsc --noEmit` limpio) y
  debería compilarse y ejecutarse con `expo prebuild` + `expo run:android`/`run:ios`
  en una máquina con las herramientas nativas instaladas.

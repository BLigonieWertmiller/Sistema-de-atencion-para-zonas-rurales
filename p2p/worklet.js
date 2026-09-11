/**
 * Código que corre dentro del runtime Bare embebido (react-native-bare-kit),
 * NO en el hilo de JS de React Native. Se empaqueta con `bare-pack`
 * (ver scripts/build-worklet.mjs) y se arranca desde
 * `src/p2p/peerSync.ts` con `worklet.start('/app.bundle', bundleBytes)`.
 *
 * Responsabilidad única: unirse, por DOS transportes en paralelo, a la red
 * P2P identificada por un topic derivado del "código de cuadrilla" que
 * manda React Native, y hacer de gateway simple entre esa red y la app —
 * nunca toma decisiones de negocio (eso vive del lado de React Native):
 *
 *   - Hyperswarm (HyperDHT): funciona si hay algún camino de red (wifi
 *     local compartido, o una ventana breve de señal para el handshake
 *     inicial). Alcance: el de esa red.
 *   - ble-swarm (Bluetooth LE, @holepunchto/ble-swarm sobre bare-bluetooth):
 *     funciona con CERO red de por medio — el caso límite real de "donde la
 *     nube no debería llegar", dos radios BLE viéndose directamente.
 *     Alcance: line-of-sight BLE, unos 10-30m típico.
 *
 * Ambos transportes emiten el mismo tipo de conexión (un NoiseSecretStream
 * cifrado) sobre la misma interfaz dúplex, así que comparten un único
 * manejador de peers (`attachPeer`) — el resto del protocolo no distingue
 * por qué radio llegó un mensaje.
 *
 * Protocolo con React Native (por `BareKit.IPC`, un stream dúplex de bytes):
 * usa `bare-rpc`, un comando por mensaje, ver PROTOCOLO más abajo.
 *
 * Protocolo entre peers (por el socket que entregan `swarm.on('connection')`
 * / `bt.on('connection')`): líneas de texto terminadas en '\n', cada una un
 * JSON `{ type, payload }`. Deliberadamente simple (no bare-rpc) porque acá
 * el número de peers no es 1, y un framing de líneas es trivial de auditar
 * a simple vista.
 */
const Hyperswarm = require('hyperswarm')
const BluetoothSwarm = require('ble-swarm')
const crypto = require('hypercore-crypto')
const RPC = require('bare-rpc')
const b4a = require('b4a')

// PROTOCOLO RN -> worklet (comandos por número, ver src/p2p/protocol.ts)
const CMD_JOIN = 1 // data: { topicHex }
const CMD_LEAVE = 2 // sin data
const CMD_BROADCAST = 3 // data: { type: 'sos' | 'entry' | 'checkin', payload }

// PROTOCOLO worklet -> RN (mismos números, respuesta a request, o notificación)
const EVT_PEER_COUNT = 10 // data: { count }
const EVT_MESSAGE = 11 // data: { type: 'sos' | 'entry' | 'checkin', payload, fromPeer }

const MESSAGE_TYPES = new Set(['sos', 'entry', 'checkin'])

// Un peer del swarm no está autenticado más allá de conocer el código de
// cuadrilla (ver protocol.ts), así que se lo trata como entrada hostil a
// nivel de transporte, no solo de contenido:
//   - MAX_BUFFER_BYTES: si nunca manda un '\n' (o manda una línea gigante),
//     el buffer de reensamblado creceria sin límite -> agotamiento de
//     memoria del proceso Bare. Pasado el tope, se corta la conexión.
//   - RATE_LIMIT_*: sin esto, un peer podría inundar con mensajes
//     perfectamente válidos (payload legítimo, "sos"/"entry" nuevos con
//     cada envío) para saturar SQLite/la UI del lado React Native, o para
//     "gastar" alertas SOS falsas en cadena.
const MAX_BUFFER_BYTES = 64 * 1024
const RATE_LIMIT_WINDOW_MS = 10_000
const RATE_LIMIT_MAX_MESSAGES = 40

const { IPC } = BareKit

// Una sola identidad Noise compartida entre los dos transportes: el mismo
// par de claves para Hyperswarm y para ble-swarm significa que un
// compañero que te ve por wifi Y por Bluetooth es UN peer, no dos, a nivel
// de identidad criptográfica (el conteo/gossip igual puede duplicar la
// conexión — ver nota en README).
const keyPair = crypto.keyPair()

const swarm = new Hyperswarm({ keyPair })
const bt = new BluetoothSwarm({ keyPair })

const peers = new Set()
let currentTopic = null
let bleStarted = false

function send(command, data) {
  const req = rpc.request(command)
  req.send(JSON.stringify(data))
}

function broadcastToPeers(message) {
  const line = JSON.stringify(message) + '\n'
  for (const socket of peers) {
    socket.write(line)
  }
}

function attachPeer(socket, remotePublicKey) {
  peers.add(socket)
  send(EVT_PEER_COUNT, { count: peers.size })

  const fromPeer = b4a.toString(remotePublicKey, 'hex').slice(0, 8)

  let buffer = ''
  let messageTimestamps = []

  function overRateLimit() {
    const now = Date.now()
    messageTimestamps = messageTimestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    messageTimestamps.push(now)
    return messageTimestamps.length > RATE_LIMIT_MAX_MESSAGES
  }

  socket.on('data', (chunk) => {
    if (buffer.length + chunk.length > MAX_BUFFER_BYTES) {
      // Peer abusivo: nunca manda '\n' o manda una línea absurdamente larga.
      // Cortar la conexión en vez de dejar crecer el buffer sin límite.
      socket.destroy()
      return
    }
    buffer += b4a.toString(chunk)
    let newlineIndex
    // eslint-disable-next-line no-cond-assign
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue
      if (overRateLimit()) {
        socket.destroy()
        return
      }
      try {
        const message = JSON.parse(line)
        if (message && MESSAGE_TYPES.has(message.type)) {
          send(EVT_MESSAGE, { type: message.type, payload: message.payload, fromPeer })
        }
      } catch {
        // Línea que no es JSON válido: se descarta. Nunca se ejecuta ni
        // se interpreta como comando — es dato de otro peer, no confiable.
      }
    }
  })

  const onClose = () => {
    peers.delete(socket)
    send(EVT_PEER_COUNT, { count: peers.size })
  }
  socket.on('close', onClose)
  socket.on('error', onClose)
}

swarm.on('connection', (socket, peerInfo) => attachPeer(socket, peerInfo.publicKey))
bt.on('connection', (conn) => attachPeer(conn, conn.remotePublicKey))

const rpc = new RPC(IPC, (req) => {
  const data = req.data ? JSON.parse(b4a.toString(req.data)) : null

  if (req.command === CMD_JOIN) {
    currentTopic = b4a.from(data.topicHex, 'hex')
    swarm.join(currentTopic, { server: true, client: true })

    // ble-swarm es tolerante a hardware/plataformas sin BLE: en ese caso
    // reporta `unsupported` y estas llamadas son un no-op inofensivo.
    if (!bleStarted) {
      bleStarted = true
      bt.start().catch(() => {})
    }
    bt.setTopic(currentTopic).catch(() => {})
    return
  }

  if (req.command === CMD_LEAVE) {
    if (currentTopic) {
      swarm.leave(currentTopic)
      currentTopic = null
    }
    if (bleStarted) {
      bleStarted = false
      bt.stop().catch(() => {})
    }
    return
  }

  if (req.command === CMD_BROADCAST) {
    broadcastToPeers({ type: data.type, payload: data.payload })
    return
  }
})

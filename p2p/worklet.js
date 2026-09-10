/**
 * Código que corre dentro del runtime Bare embebido (react-native-bare-kit),
 * NO en el hilo de JS de React Native. Se empaqueta con `bare-pack`
 * (ver scripts/build-worklet.mjs) y se arranca desde
 * `src/p2p/peerSync.ts` con `worklet.start('/app.bundle', bundleBytes)`.
 *
 * Responsabilidad única: unirse a un swarm de Hyperswarm identificado por
 * un topic derivado del "código de cuadrilla" que le manda React Native, y
 * hacer de gateway simple entre esa red P2P y la app — nunca toma
 * decisiones de negocio (eso vive del lado de React Native).
 *
 * Protocolo con React Native (por `BareKit.IPC`, un stream dúplex de bytes):
 * usa `bare-rpc`, un comando por mensaje, ver PROTOCOLO más abajo.
 *
 * Protocolo entre peers (por el socket que entrega `swarm.on('connection')`):
 * líneas de texto terminadas en '\n', cada una un JSON `{ type, payload }`.
 * Deliberadamente simple (no bare-rpc) porque acá el número de peers no es
 * 1, y un framing de líneas es trivial de auditar a simple vista.
 */
const Hyperswarm = require('hyperswarm')
const RPC = require('bare-rpc')
const b4a = require('b4a')

// PROTOCOLO RN -> worklet (comandos por número, ver src/p2p/protocol.ts)
const CMD_JOIN = 1 // data: { topicHex }
const CMD_LEAVE = 2 // sin data
const CMD_BROADCAST = 3 // data: { type: 'sos' | 'entry', payload }

// PROTOCOLO worklet -> RN (mismos números, respuesta a request, o notificación)
const EVT_PEER_COUNT = 10 // data: { count }
const EVT_MESSAGE = 11 // data: { type: 'sos' | 'entry', payload, fromPeer }

const { IPC } = BareKit

const swarm = new Hyperswarm()
const peers = new Set()
let currentTopic = null

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

swarm.on('connection', (socket, peerInfo) => {
  peers.add(socket)
  send(EVT_PEER_COUNT, { count: peers.size })

  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += b4a.toString(chunk)
    let newlineIndex
    // eslint-disable-next-line no-cond-assign
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        if (message && (message.type === 'sos' || message.type === 'entry')) {
          send(EVT_MESSAGE, {
            type: message.type,
            payload: message.payload,
            fromPeer: b4a.toString(peerInfo.publicKey, 'hex').slice(0, 8)
          })
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
})

const rpc = new RPC(IPC, (req) => {
  const data = req.data ? JSON.parse(b4a.toString(req.data)) : null

  if (req.command === CMD_JOIN) {
    currentTopic = b4a.from(data.topicHex, 'hex')
    swarm.join(currentTopic, { server: true, client: true })
    return
  }

  if (req.command === CMD_LEAVE) {
    if (currentTopic) {
      swarm.leave(currentTopic)
      currentTopic = null
    }
    return
  }

  if (req.command === CMD_BROADCAST) {
    broadcastToPeers({ type: data.type, payload: data.payload })
    return
  }
})

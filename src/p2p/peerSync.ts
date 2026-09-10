import * as Crypto from 'expo-crypto';
import { Worklet } from 'react-native-bare-kit';
import RPC from 'bare-rpc';
import b4a from 'b4a';

import { base64ToBytes } from './base64';
import {
  CMD_BROADCAST,
  CMD_JOIN,
  CMD_LEAVE,
  EVT_MESSAGE,
  EVT_PEER_COUNT,
  peerMessageEventSchema,
  type CheckinPayload,
  type EntryPayload,
  type PeerMessageEvent,
  type SosPayload
} from './protocol';
import { WORKLET_BUNDLE_BASE64 } from './workletBundle.generated';

type PeerCountListener = (count: number) => void;
type MessageListener = (event: PeerMessageEvent) => void;

/**
 * Puente entre React Native y el worklet Bare que corre Hyperswarm
 * (`p2p/worklet.js`, empaquetado en `workletBundle.generated.ts`). Todo lo
 * que expone esta clase es fire-and-forget desde el punto de vista de RN —
 * no hay awaits sobre operaciones de red, porque la red P2P puede tardar
 * arbitrariamente (o nunca) en encontrar un par.
 *
 * Es un singleton de facto: solo tiene sentido un worklet por sesión de la
 * app, así que se expone como instancia ya creada al final del archivo.
 */
class PeerSync {
  private worklet: Worklet | null = null;
  private rpc: RPC | null = null;
  private peerCount = 0;
  private readonly peerCountListeners = new Set<PeerCountListener>();
  private readonly messageListeners = new Set<MessageListener>();

  get connectedPeerCount(): number {
    return this.peerCount;
  }

  get isRunning(): boolean {
    return this.worklet !== null;
  }

  /** Arranca el worklet (una sola vez) y lo deja escuchando eventos, sin unirse a ningún swarm todavía. */
  start(): void {
    if (this.worklet) return;

    try {
      const worklet = new Worklet();
      const bundleBytes = base64ToBytes(WORKLET_BUNDLE_BASE64);
      worklet.start('/app.bundle', bundleBytes);

      this.rpc = new RPC(worklet.IPC as unknown as ConstructorParameters<typeof RPC>[0], (req) => {
        const data = req.data ? JSON.parse(b4a.toString(req.data)) : null;

        if (req.command === EVT_PEER_COUNT && data && typeof data.count === 'number') {
          this.peerCount = data.count;
          this.peerCountListeners.forEach((listener) => listener(this.peerCount));
        } else if (req.command === EVT_MESSAGE && data) {
          // Este mensaje se originó en OTRO dispositivo del swarm P2P — nunca
          // se confía en su forma. Un payload que no valida se descarta acá,
          // antes de llegar a la UI o a la base de datos.
          const parsed = peerMessageEventSchema.safeParse(data);
          if (!parsed.success) {
            console.warn('Mensaje P2P descartado: no matchea el schema esperado.', parsed.error.message);
            return;
          }
          this.messageListeners.forEach((listener) => listener(parsed.data));
        }
      });

      this.worklet = worklet;
    } catch (error) {
      console.warn('No se pudo arrancar el worklet P2P (Pears/Hyperswarm):', error);
      this.worklet = null;
      this.rpc = null;
    }
  }

  /** Deriva un topic de 32 bytes a partir del código de cuadrilla y se une al swarm de ese equipo. */
  async join(teamCode: string): Promise<void> {
    if (!this.rpc) return;
    const topicHex = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `agente-de-campo:${teamCode}`,
      { encoding: Crypto.CryptoEncoding.HEX }
    );
    this.send(CMD_JOIN, { topicHex });
  }

  leave(): void {
    if (!this.rpc) return;
    this.send(CMD_LEAVE, null);
  }

  broadcastSos(payload: SosPayload): void {
    if (!this.rpc) return;
    this.send(CMD_BROADCAST, { type: 'sos', payload });
  }

  broadcastEntry(payload: EntryPayload): void {
    if (!this.rpc) return;
    this.send(CMD_BROADCAST, { type: 'entry', payload });
  }

  broadcastCheckin(payload: CheckinPayload): void {
    if (!this.rpc) return;
    this.send(CMD_BROADCAST, { type: 'checkin', payload });
  }

  onPeerCountChange(listener: PeerCountListener): () => void {
    this.peerCountListeners.add(listener);
    return () => this.peerCountListeners.delete(listener);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  stop(): void {
    this.worklet?.terminate();
    this.worklet = null;
    this.rpc = null;
    this.peerCount = 0;
  }

  private send(command: number, data: unknown): void {
    if (!this.rpc) return;
    const req = this.rpc.request(command);
    req.send(JSON.stringify(data));
  }
}

export const peerSync = new PeerSync();

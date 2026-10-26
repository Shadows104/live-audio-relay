import { MODULE_ID, getBitrate, getIceServers } from "./settings.js";
import { tuneOpus } from "./sdp.js";

const changed = () => Hooks.callAll(`${MODULE_ID}.changed`);

/**
 * The GM side: holds the captured stream and one peer connection per listener.
 */
export class Broadcaster {
  /** @type {(message: object) => void} */
  #send;

  /** @type {Map<string, {pc: RTCPeerConnection, pending: RTCIceCandidateInit[]}>} */
  #peers = new Map();

  /** @type {MediaStream|null} */
  stream = null;

  constructor(send) {
    this.#send = send;
  }

  get live() {
    return !!this.stream;
  }

  /** @returns {{userId: string, state: RTCPeerConnectionState}[]} */
  get listeners() {
    return [...this.#peers].map(([userId, { pc }]) => ({ userId, state: pc.connectionState }));
  }

  /**
   * Start broadcasting a stream and invite everyone to connect. The caller owns
   * the stream; stopping the broadcast leaves its tracks running.
   * @param {MediaStream} stream
   */
  start(stream) {
    if (!stream?.getAudioTracks().length) throw new Error(game.i18n.localize("LIVEAUDIO.Error.NoAudio"));
    this.stop();
    this.stream = stream;
    this.#send({ type: "start" });
    changed();
  }

  stop() {
    if (!this.stream) return;
    for (const userId of [...this.#peers.keys()]) this.drop(userId);
    this.stream = null;
    this.#send({ type: "stop" });
    changed();
  }

  /** A listener asked to connect: open a peer connection and send it an offer. */
  async onJoin(userId) {
    if (!this.live) return;
    this.drop(userId);

    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    const peer = { pc, pending: [] };
    this.#peers.set(userId, peer);

    for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = event => {
      if (event.candidate) this.#send({ type: "ice", to: userId, candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.#peers.get(userId) !== peer) return;
      if (["failed", "closed"].includes(pc.connectionState)) this.drop(userId);
      else changed();
    };

    try {
      const offer = await pc.createOffer();
      offer.sdp = tuneOpus(offer.sdp, getBitrate());
      await pc.setLocalDescription(offer);
      this.#send({ type: "offer", to: userId, sdp: offer.sdp });
    } catch (err) {
      if (this.#peers.get(userId) !== peer) return;
      console.error(`${MODULE_ID} | Failed to create offer for ${userId}`, err);
      this.drop(userId);
    }
    changed();
  }

  async onAnswer(userId, sdp) {
    const peer = this.#peers.get(userId);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription({ type: "answer", sdp: tuneOpus(sdp, getBitrate()) });
      for (const candidate of peer.pending.splice(0)) await peer.pc.addIceCandidate(candidate);
      for (const sender of peer.pc.getSenders()) {
        const params = sender.getParameters();
        if (!params.encodings?.length) continue;
        params.encodings[0].maxBitrate = getBitrate();
        await sender.setParameters(params);
      }
    } catch (err) {
      if (this.#peers.get(userId) !== peer) return;
      console.error(`${MODULE_ID} | Failed to apply answer from ${userId}`, err);
      this.drop(userId);
    }
  }

  async onIce(userId, candidate) {
    const peer = this.#peers.get(userId);
    if (!peer) return;
    if (!peer.pc.remoteDescription) return void peer.pending.push(candidate);
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn(`${MODULE_ID} | Ignored ICE candidate from ${userId}`, err);
    }
  }

  /** Close and forget one listener's connection. */
  drop(userId) {
    const peer = this.#peers.get(userId);
    if (!peer) return;
    this.#peers.delete(userId);
    peer.pc.close();
    changed();
  }
}

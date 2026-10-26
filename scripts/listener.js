import { MODULE_ID, getBitrate, getIceServers, getListenVolume } from "./settings.js";
import { tuneOpus } from "./sdp.js";

const MAX_RETRIES = 3;
const RETRY_DELAY = 3000;

/**
 * The player side: one peer connection to whoever is broadcasting, played
 * through a hidden audio element.
 */
export class Listener {
  /** @type {(message: object) => void} */
  #send;

  /** @type {RTCPeerConnection|null} */
  #pc = null;

  /** @type {RTCIceCandidateInit[]} */
  #pending = [];

  /** The broadcasting user's id. */
  #source = null;

  #retries = 0;

  #audio = Object.assign(document.createElement("audio"), { autoplay: true });

  constructor(send) {
    this.#send = send;
    this.applyVolume();
  }

  get listening() {
    return game.settings.get(MODULE_ID, "listen");
  }

  /** Ask whoever is live to connect to us. Nobody answers if nothing is live. */
  join() {
    if (this.listening) this.#send({ type: "join" });
  }

  /** Disconnect and tell the broadcaster to forget us. */
  leave() {
    if (this.#source) this.#send({ type: "leave", to: this.#source });
    this.#close();
  }

  async onOffer(userId, sdp) {
    if (!this.listening) return;
    this.#close();
    this.#source = userId;

    const pc = this.#pc = new RTCPeerConnection({ iceServers: getIceServers() });
    pc.ontrack = event => {
      this.#audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      this.#play();
    };
    pc.onicecandidate = event => {
      if (event.candidate) this.#send({ type: "ice", to: userId, candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.#pc !== pc) return;
      if (pc.connectionState === "connected") this.#retries = 0;
      if (pc.connectionState === "failed") this.#retry();
    };

    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      for (const candidate of this.#pending.splice(0)) await pc.addIceCandidate(candidate);
      const answer = await pc.createAnswer();
      answer.sdp = tuneOpus(answer.sdp, getBitrate());
      await pc.setLocalDescription(answer);
      this.#send({ type: "answer", to: userId, sdp: answer.sdp });
    } catch (err) {
      if (this.#pc !== pc) return;
      console.error(`${MODULE_ID} | Failed to answer ${userId}`, err);
      this.#close();
    }
  }

  async onIce(userId, candidate) {
    if (userId !== this.#source) return;
    if (!this.#pc?.remoteDescription) return void this.#pending.push(candidate);
    try {
      await this.#pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn(`${MODULE_ID} | Ignored ICE candidate from ${userId}`, err);
    }
  }

  onStop(userId) {
    if (userId === this.#source) this.#close();
  }

  /** Our volume setting, scaled by Foundry's own music volume. */
  applyVolume() {
    this.#audio.volume = getListenVolume();
  }

  /** Browsers block audio until the user has clicked something; wait for that if needed. */
  #play() {
    this.#audio.play().catch(async () => {
      await game.audio.awaitFirstGesture?.();
      this.#audio.play().catch(err => console.warn(`${MODULE_ID} | Could not start playback`, err));
    });
  }

  /** The connection dropped: try again a few times before giving up. */
  #retry() {
    const source = this.#source;
    this.#close();
    if (++this.#retries > MAX_RETRIES) {
      ui.notifications.warn("LIVEAUDIO.Error.ConnectFailed", { localize: true });
      this.#retries = 0;
      return;
    }
    setTimeout(() => {
      if (!this.#pc && this.listening) this.#send({ type: "join", to: source });
    }, RETRY_DELAY);
  }

  #close() {
    this.#pc?.close();
    this.#pc = null;
    this.#pending = [];
    this.#source = null;
    this.#audio.srcObject = null;
  }
}

import { MODULE_ID, getListenVolume } from "./settings.js";

const changed = () => Hooks.callAll(`${MODULE_ID}.changed`);

/**
 * @typedef {object} MixSource
 * @property {string} id
 * @property {string} key       What the source's volume is remembered under: "display" or a device id.
 * @property {string} label
 * @property {"display"|"device"} kind
 * @property {MediaStream} stream
 * @property {MediaStreamAudioSourceNode} input
 * @property {AnalyserNode} analyser
 * @property {GainNode} gain
 * @property {number} volume
 * @property {boolean} muted
 */

/**
 * Blends any number of captured streams into one stereo track. The output track
 * never changes, so sources can come and go while listeners stay connected.
 */
export class Mixer {
  /** @type {AudioContext|null} */
  #ctx = null;

  /** @type {MediaStreamAudioDestinationNode|null} */
  #output = null;

  /** Where sources plug in: a limiter in front of the output. @type {AudioNode|null} */
  #bus = null;

  /** Plays the mix on the GM's own speakers when they want to hear it. @type {GainNode|null} */
  #monitor = null;

  /** @type {Map<string, MixSource>} */
  #sources = new Map();

  #nextId = 1;

  /** The mixed stream to broadcast. Only available once a source has been added. */
  get stream() {
    return this.#output?.stream ?? null;
  }

  /** @returns {MixSource[]} */
  get sources() {
    return [...this.#sources.values()];
  }

  /** @param {string} key */
  has(key) {
    return this.sources.some(source => source.key === key);
  }

  /**
   * Add a captured stream to the mix. The mixer now owns it and stops it on removal.
   * @param {MediaStream} stream
   * @param {{kind: "display"|"device", key: string, label: string}} info
   * @returns {MixSource}
   */
  add(stream, { kind, key, label }) {
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error(game.i18n.localize("LIVEAUDIO.Error.NoAudio"));
    }
    const ctx = this.#context();
    const { volume = 1, muted = false } = this.#levels[key] ?? {};

    const input = ctx.createMediaStreamSource(stream);
    const analyser = Object.assign(ctx.createAnalyser(), { fftSize: 1024 });
    const gain = ctx.createGain();
    gain.gain.value = muted ? 0 : volume;
    // The meter reads the input before the fader, so it shows whether audio is arriving at all.
    input.connect(analyser);
    input.connect(gain).connect(this.#bus);

    const source = { id: String(this.#nextId++), key, label, kind, stream, input, analyser, gain, volume, muted };
    this.#sources.set(source.id, source);
    // The browser's "Stop sharing" bar ends the tracks; drop the source when that happens.
    for (const t of stream.getTracks()) t.addEventListener("ended", () => this.remove(source.id));
    changed();
    return source;
  }

  remove(id) {
    const source = this.#sources.get(id);
    if (!source) return;
    this.#sources.delete(id);
    source.input.disconnect();
    source.gain.disconnect();
    source.stream.getTracks().forEach(t => t.stop());
    changed();
  }

  /** Change a source's volume without re-rendering anything, so sliders can be dragged smoothly. */
  setVolume(id, volume) {
    const source = this.#sources.get(id);
    if (!source) return;
    source.volume = volume;
    if (!source.muted) source.gain.gain.setTargetAtTime(volume, this.#ctx.currentTime, 0.02);
    this.#remember(source);
  }

  setMuted(id, muted) {
    const source = this.#sources.get(id);
    if (!source) return;
    source.muted = muted;
    source.gain.gain.setTargetAtTime(muted ? 0 : source.volume, this.#ctx.currentTime, 0.02);
    this.#remember(source);
    changed();
  }

  /** Turn the GM's monitor on or off, at the same volume players hear. */
  applyMonitor() {
    if (!this.#monitor) return;
    const volume = game.settings.get(MODULE_ID, "monitor") ? getListenVolume() : 0;
    this.#monitor.gain.setTargetAtTime(volume, this.#ctx.currentTime, 0.02);
  }

  /**
   * Peak input level of a source, from 0 to 1.
   * @param {string} id
   */
  level(id) {
    const analyser = this.#sources.get(id)?.analyser;
    if (!analyser) return 0;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    return Math.min(peak, 1);
  }

  #context() {
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ latencyHint: "playback" });
      this.#output = this.#ctx.createMediaStreamDestination();
      // Several loud sources add up past full scale; catch the peaks instead of clipping.
      this.#bus = new DynamicsCompressorNode(this.#ctx, {
        threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.25
      });
      this.#bus.connect(this.#output);
      this.#monitor = this.#ctx.createGain();
      this.#bus.connect(this.#monitor).connect(this.#ctx.destination);
      this.applyMonitor();
    }
    // Adding a source always follows a click, so the browser lets the context start.
    this.#ctx.resume();
    return this.#ctx;
  }

  /** Volumes are remembered per device, and once for shared tabs and screens. */
  #remember({ key, volume, muted }) {
    this.#levels[key] = { volume, muted };
    this.#saveLevels();
  }

  /** @type {Record<string, {volume: number, muted: boolean}>} */
  get #levels() {
    return this.#cachedLevels ??= { ...game.settings.get(MODULE_ID, "levels") };
  }

  #cachedLevels = null;

  #saveLevels = foundry.utils.debounce(() => game.settings.set(MODULE_ID, "levels", this.#levels), 500);
}

import { MODULE_ID } from "./settings.js";
import { captureDevice, captureDisplay, displayCaptureSupport, listInputs } from "./capture.js";

const { ApplicationV2 } = foundry.applications.api;
const DISPLAY = "display";

/** What the share picker's choice was, for naming a shared source. */
const SURFACES = { browser: "SurfaceTab", window: "SurfaceWindow", monitor: "SurfaceScreen" };

/**
 * GM control panel: build a mix of sources, go live, and see who is listening.
 */
export class LiveAudioPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "live-audio-panel",
    classes: ["live-audio-panel"],
    window: { title: "LIVEAUDIO.Panel.Title", icon: "fa-solid fa-tower-broadcast", resizable: false },
    position: { width: 380, height: "auto" },
    actions: {
      add: LiveAudioPanel.#onAdd,
      remove: LiveAudioPanel.#onRemove,
      mute: LiveAudioPanel.#onMute,
      monitor: LiveAudioPanel.#onMonitor,
      start: LiveAudioPanel.#onStart,
      stop: LiveAudioPanel.#onStop,
      refresh: LiveAudioPanel.#onRefresh
    }
  };

  constructor({ broadcaster, listener, mixer }, options = {}) {
    super(options);
    this.broadcaster = broadcaster;
    this.listener = listener;
    this.mixer = mixer;
  }

  #hookId;

  /** @type {MediaDeviceInfo[]} */
  #devices = [];

  #busy = false;

  #meterFrame = null;

  get #choice() {
    return game.settings.get(MODULE_ID, "source");
  }

  /** @override */
  async _preFirstRender(context, options) {
    await super._preFirstRender(context, options);
    this.#devices = await listInputs().catch(() => []);
  }

  /** @override */
  async _renderHTML() {
    const t = key => game.i18n.localize(`LIVEAUDIO.Panel.${key}`);
    const esc = foundry.utils.escapeHTML;
    const live = this.broadcaster.live;
    const monitor = game.settings.get(MODULE_ID, "monitor");
    const sources = this.mixer.sources;
    const choice = this.#choice;
    // Device names stay blank until the browser has granted microphone access.
    const unlabeled = this.#devices.some(d => !d.label);

    const rows = sources.map(s => `
      <li class="la-source ${s.muted ? "la-muted" : ""}" data-id="${s.id}">
        <i class="fa-solid ${s.kind === DISPLAY ? "fa-display" : "fa-microphone-lines"}"></i>
        <div class="la-source-body">
          <span class="la-source-name">${esc(s.label)}</span>
          <div class="la-meter"><div class="la-meter-fill" data-id="${s.id}"></div></div>
          <input type="range" min="0" max="1" step="0.01" value="${s.volume}" data-id="${s.id}"
                 aria-label="${t("Volume")}">
        </div>
        <button type="button" data-action="mute" data-tooltip="${t(s.muted ? "Unmute" : "Mute")}">
          <i class="fa-solid ${s.muted ? "fa-volume-xmark" : "fa-volume-high"}"></i>
        </button>
        <button type="button" data-action="remove" data-tooltip="${t("Remove")}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </li>`);

    const options = [
      `<option value="${DISPLAY}">${t("SourceDisplay")}</option>`,
      ...this.#devices.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === choice ? "selected" : ""}
        ${this.mixer.has(d.deviceId) ? "disabled" : ""}>
        ${esc(d.label || game.i18n.format("LIVEAUDIO.Panel.UnnamedDevice", { n: i + 1 }))}</option>`)
    ];
    // A device can only be in the mix once; tabs and screens can be shared as often as you like.
    const support = displayCaptureSupport();
    const canAdd = !this.#busy && (choice === DISPLAY ? support === "ok" : !this.mixer.has(choice));

    const listeners = this.broadcaster.listeners.map(({ userId, state }) => `
      <li class="la-${state}">
        <span>${esc(game.users.get(userId)?.name ?? userId)}</span>
        <span class="la-state">${game.i18n.localize(`LIVEAUDIO.State.${state}`)}</span>
      </li>`);

    const root = document.createElement("div");
    root.innerHTML = `
      <div class="la-status ${live ? "la-live" : ""}">
        <i class="fa-solid ${live ? "fa-circle" : "fa-circle-stop"}"></i>
        <span>${t(live ? "Live" : "Off")}</span>
        <button type="button" class="la-monitor ${monitor ? "active" : ""}" data-action="monitor" aria-pressed="${monitor}"
                data-tooltip="${t(monitor ? "MonitorOff" : "MonitorOn")}">
          <i class="fa-solid ${monitor ? "fa-headphones" : "fa-headphones-simple"}"></i> ${t("Monitor")}
        </button>
      </div>
      ${monitor ? `<p class="hint">${t("HintMonitor")}</p>` : ""}
      <h4>${t("Mix")}</h4>
      ${rows.length
        ? `<ul class="la-sources">${rows.join("")}</ul>`
        : `<p class="la-empty">${t(live ? "SilentLive" : "NoSources")}</p>`}
      <label class="la-field">
        <span>${t("AddSource")}</span>
        <div class="la-row">
          <select name="source">${options.join("")}</select>
          <button type="button" data-action="refresh" data-tooltip="${t("Refresh")}">
            <i class="fa-solid fa-rotate"></i>
          </button>
          <button type="button" class="la-add" data-action="add" ${canAdd ? "" : "disabled"}>
            <i class="fa-solid fa-plus"></i> ${t("Add")}
          </button>
        </div>
      </label>
      ${choice === DISPLAY && support !== "ok"
        ? `<p class="la-warning">${t(support === "app" ? "WarnApp" : "WarnBrowser")}</p>`
        : `<p class="hint">${t(choice === DISPLAY ? "HintDisplay" : "HintDevice")}</p>`}
      ${unlabeled ? `<p class="hint">${t("HintLabels")}</p>` : ""}
      ${live ? `
        <h4>${t("Listeners")}</h4>
        ${listeners.length ? `<ul class="la-listeners">${listeners.join("")}</ul>` : `<p class="la-empty">${t("NoListeners")}</p>`}` : ""}
      <footer>
        ${live
          ? `<button type="button" data-action="stop"><i class="fa-solid fa-stop"></i> ${t("Stop")}</button>`
          : `<button type="button" data-action="start" ${sources.length ? "" : "disabled"}><i class="fa-solid fa-play"></i> ${t("Start")}</button>`}
      </footer>`;
    return root;
  }

  /** @override */
  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const select = this.element.querySelector("select[name=source]");
    // The remembered device may be unplugged; fall back to sharing a tab or screen.
    if (select.value !== this.#choice) game.settings.set(MODULE_ID, "source", select.value);
    select.addEventListener("change", async () => {
      await game.settings.set(MODULE_ID, "source", select.value);
      this.render();
    });
    for (const slider of this.element.querySelectorAll(".la-source input[type=range]")) {
      slider.addEventListener("input", () => this.mixer.setVolume(slider.dataset.id, Number(slider.value)));
    }
    this.#meterFrame ??= requestAnimationFrame(this.#drawMeters);
  }

  /** Animate each source's level meter while the panel is open. */
  #drawMeters = () => {
    if (!this.rendered) return void (this.#meterFrame = null);
    for (const fill of this.element.querySelectorAll(".la-meter-fill")) {
      fill.style.width = `${Math.round(this.mixer.level(fill.dataset.id) * 100)}%`;
    }
    this.#meterFrame = requestAnimationFrame(this.#drawMeters);
  };

  static async #onAdd() {
    if (this.#busy) return;
    this.#busy = true;
    this.render();
    const choice = this.#choice;
    try {
      if (choice === DISPLAY) {
        const stream = await captureDisplay();
        this.mixer.add(stream, { kind: DISPLAY, key: DISPLAY, label: this.#displayLabel(stream) });
      } else {
        const device = this.#devices.find(d => d.deviceId === choice);
        const stream = await captureDevice(choice);
        this.mixer.add(stream, { kind: "device", key: choice, label: device?.label || stream.getAudioTracks()[0].label });
      }
    } catch (err) {
      // Closing the share picker is not an error worth reporting.
      if (err.name !== "NotAllowedError" && err.name !== "AbortError") {
        console.error(`${MODULE_ID} | Failed to add source`, err);
        ui.notifications.error(game.i18n.format("LIVEAUDIO.Error.Add", { message: err.message }));
      }
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  /** "Browser tab 2", "Screen", and so on, numbered when there's more than one of a kind. */
  #displayLabel(stream) {
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
    const name = game.i18n.localize(`LIVEAUDIO.Panel.${SURFACES[surface] ?? "SurfaceShared"}`);
    const taken = new Set(this.mixer.sources.map(s => s.label));
    if (!taken.has(name)) return name;
    let n = 2;
    while (taken.has(`${name} ${n}`)) n++;
    return `${name} ${n}`;
  }

  static #onRemove(_event, target) {
    this.mixer.remove(target.closest("[data-id]").dataset.id);
  }

  static #onMute(_event, target) {
    const id = target.closest("[data-id]").dataset.id;
    const source = this.mixer.sources.find(s => s.id === id);
    if (source) this.mixer.setMuted(id, !source.muted);
  }

  static async #onMonitor() {
    await game.settings.set(MODULE_ID, "monitor", !game.settings.get(MODULE_ID, "monitor"));
    this.mixer.applyMonitor();
    this.render();
  }

  static #onStart() {
    try {
      // Don't play the GM's own broadcast back to them.
      this.listener.leave();
      this.broadcaster.start(this.mixer.stream);
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to start`, err);
      ui.notifications.error(game.i18n.format("LIVEAUDIO.Error.Start", { message: err.message }));
    }
  }

  static #onStop() {
    this.broadcaster.stop();
  }

  static async #onRefresh() {
    try {
      this.#devices = await listInputs(true);
    } catch (err) {
      ui.notifications.warn(game.i18n.format("LIVEAUDIO.Error.Devices", { message: err.message }));
      this.#devices = await listInputs().catch(() => []);
    }
    this.render();
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#hookId = Hooks.on(`${MODULE_ID}.changed`, () => this.render());
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    Hooks.off(`${MODULE_ID}.changed`, this.#hookId);
  }
}

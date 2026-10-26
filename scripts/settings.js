export const MODULE_ID = "live-audio-relay";
export const SOCKET = `module.${MODULE_ID}`;

const DEFAULT_ICE_SERVERS = JSON.stringify([
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
]);

/**
 * Register the module's settings.
 * @param {object} callbacks
 * @param {(listen: boolean) => void} callbacks.onListenChange
 * @param {() => void} callbacks.onVolumeChange
 */
export function registerSettings({ onListenChange, onVolumeChange }) {
  game.settings.register(MODULE_ID, "listen", {
    name: "LIVEAUDIO.Settings.Listen.Name",
    hint: "LIVEAUDIO.Settings.Listen.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: onListenChange
  });

  game.settings.register(MODULE_ID, "volume", {
    name: "LIVEAUDIO.Settings.Volume.Name",
    hint: "LIVEAUDIO.Settings.Volume.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.8,
    onChange: onVolumeChange
  });

  game.settings.register(MODULE_ID, "bitrate", {
    name: "LIVEAUDIO.Settings.Bitrate.Name",
    hint: "LIVEAUDIO.Settings.Bitrate.Hint",
    scope: "world",
    config: true,
    type: Number,
    choices: {
      96000: "96 kbps",
      128000: "128 kbps",
      192000: "192 kbps",
      256000: "256 kbps"
    },
    default: 128000
  });

  game.settings.register(MODULE_ID, "iceServers", {
    name: "LIVEAUDIO.Settings.IceServers.Name",
    hint: "LIVEAUDIO.Settings.IceServers.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_ICE_SERVERS
  });

  // The GM's last chosen capture source, remembered between sessions.
  game.settings.register(MODULE_ID, "source", {
    scope: "client",
    config: false,
    type: String,
    default: "display"
  });

  // Whether the GM hears the mix they are sending.
  game.settings.register(MODULE_ID, "monitor", {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  // Volume and mute per mix source, keyed by device id ("display" for shared tabs and screens).
  game.settings.register(MODULE_ID, "levels", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
}

/** The live audio volume setting, scaled by Foundry's own music volume. */
export function getListenVolume() {
  let music = 1;
  try {
    const core = Number(game.settings.get("core", "globalPlaylistVolume"));
    if (Number.isFinite(core)) music = core;
  } catch {
    // Core setting renamed or missing; use our own volume alone.
  }
  return Math.clamp(game.settings.get(MODULE_ID, "volume") * music, 0, 1);
}

export function getBitrate() {
  return Number(game.settings.get(MODULE_ID, "bitrate")) || 128000;
}

/** @returns {RTCIceServer[]} */
export function getIceServers() {
  try {
    const servers = JSON.parse(game.settings.get(MODULE_ID, "iceServers"));
    if (Array.isArray(servers)) return servers;
  } catch {
    // Fall through to the default below.
  }
  console.warn(`${MODULE_ID} | ${game.i18n.localize("LIVEAUDIO.Error.IceServers")}`);
  return JSON.parse(DEFAULT_ICE_SERVERS);
}

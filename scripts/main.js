import { MODULE_ID, SOCKET, registerSettings } from "./settings.js";
import { Broadcaster } from "./broadcaster.js";
import { Listener } from "./listener.js";
import { Mixer } from "./mixer.js";
import { LiveAudioPanel } from "./panel.js";

/** Every socket message carries its sender; `to` targets one user, otherwise it goes to all. */
const send = message => game.socket.emit(SOCKET, { ...message, from: game.user.id });

/** @type {Broadcaster} */
let broadcaster;
/** @type {Listener} */
let listener;
/** @type {Mixer} */
let mixer;
/** @type {LiveAudioPanel|null} */
let panel = null;

Hooks.once("init", () => {
  registerSettings({
    onListenChange: listen => {
      if (listen) listener?.join();
      else listener?.leave();
      ui.controls?.render();
    },
    onVolumeChange: () => {
      listener?.applyVolume();
      mixer?.applyMonitor();
    }
  });
});

Hooks.once("ready", () => {
  broadcaster = new Broadcaster(send);
  listener = new Listener(send);
  mixer = new Mixer();
  game.socket.on(SOCKET, onMessage);
  // Ask if anyone is already live, for players who join mid-session.
  listener.join();
});

/** Follow Foundry's own music volume slider. */
Hooks.on("clientSettingChanged", key => {
  if (key !== "core.globalPlaylistVolume") return;
  listener?.applyVolume();
  mixer?.applyMonitor();
});

/** A player who closes their tab won't say goodbye, so drop them here. */
Hooks.on("userConnected", (user, connected) => {
  if (!connected) broadcaster?.drop(user.id);
});

function onMessage(message) {
  const { type, from, to } = message;
  if (to && to !== game.user.id) return;
  // Only a GM may send audio, so players can't hijack the table's speakers.
  const fromGM = !!game.users.get(from)?.isGM;

  switch (type) {
    case "start":
      if (!fromGM) return;
      if (broadcaster.live) {
        broadcaster.stop();
        ui.notifications.info(game.i18n.format("LIVEAUDIO.Notify.Replaced", { name: game.users.get(from).name }));
      }
      return listener.join();
    case "stop":
      if (fromGM) listener.onStop(from);
      return;
    case "offer":
      if (fromGM && !broadcaster.live) listener.onOffer(from, message.sdp);
      return;
    case "join":
      return broadcaster.onJoin(from);
    case "answer":
      return broadcaster.onAnswer(from, message.sdp);
    case "leave":
      return broadcaster.drop(from);
    case "ice":
      if (broadcaster.live) return broadcaster.onIce(from, message.candidate);
      return listener.onIce(from, message.candidate);
  }
}

function openPanel() {
  panel ??= new LiveAudioPanel({ broadcaster, listener, mixer });
  panel.render({ force: true });
}

Hooks.on("getSceneControlButtons", controls => {
  const group = controls.sounds ?? controls.tokens;
  if (!group) return;
  if (game.user.isGM) {
    group.tools.liveAudio = {
      name: "liveAudio",
      order: 100,
      title: "LIVEAUDIO.Panel.Title",
      icon: "fa-solid fa-tower-broadcast",
      button: true,
      onChange: () => openPanel()
    };
    return;
  }
  // Players can't see the sound controls, so their mute toggle lives with the tokens.
  if (!controls.tokens) return;
  controls.tokens.tools.liveAudio = {
    name: "liveAudio",
    order: 100,
    title: "LIVEAUDIO.Controls.Listen",
    icon: "fa-solid fa-headphones",
    toggle: true,
    active: game.settings.get(MODULE_ID, "listen"),
    onChange: (_event, active) => game.settings.set(MODULE_ID, "listen", active)
  };
});

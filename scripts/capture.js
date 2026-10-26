// Browser audio processing is built for voice and ruins music, so turn it all off.
const RAW_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
};

function assertCaptureSupport() {
  if (!navigator.mediaDevices) throw new Error(game.i18n.localize("LIVEAUDIO.Error.Insecure"));
}

/**
 * Whether this client can share a tab or screen with its audio.
 * Only Chromium browsers can (Chrome, Edge, Vivaldi, Brave, Arc, Opera); Foundry's desktop
 * app is Chromium too but has no share picker, and Safari and Firefox share video without audio.
 * @returns {"ok"|"app"|"browser"}
 */
export function displayCaptureSupport() {
  if (/Electron/i.test(navigator.userAgent)) return "app";
  if (!navigator.mediaDevices?.getDisplayMedia) return "app";
  // Only Chromium browsers have userAgentData, and forks don't all list a "Chromium" brand.
  return navigator.userAgentData ? "ok" : "browser";
}

/**
 * Open the browser's share picker for a tab, window or screen, with its audio.
 * @returns {Promise<MediaStream>}
 */
export async function captureDisplay() {
  assertCaptureSupport();
  const support = displayCaptureSupport();
  if (support !== "ok") throw new Error(game.i18n.localize(`LIVEAUDIO.Error.${support === "app" ? "NoDisplayCapture" : "NoTabAudio"}`));
  return navigator.mediaDevices.getDisplayMedia({
    // Chrome won't share audio without video; keep the video cheap and never send it.
    // Open the picker on the tab list, since tabs are the only source with sound on every OS.
    video: { frameRate: 1, displaySurface: "browser" },
    audio: { ...RAW_AUDIO, suppressLocalAudioPlayback: false },
    systemAudio: "include",
    selfBrowserSurface: "exclude"
  });
}

/**
 * Capture an audio input device, such as a virtual cable or a loopback monitor.
 * @param {string} deviceId
 * @returns {Promise<MediaStream>}
 */
export async function captureDevice(deviceId) {
  assertCaptureSupport();
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...RAW_AUDIO,
      deviceId: { exact: deviceId },
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 }
    }
  });
}

/**
 * List audio input devices. Browsers hide device names until the page has been
 * granted microphone access, so `requestAccess` asks for it first.
 * @param {boolean} [requestAccess=false]
 * @returns {Promise<MediaDeviceInfo[]>}
 */
export async function listInputs(requestAccess = false) {
  if (!navigator.mediaDevices) return [];
  if (requestAccess) {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach(track => track.stop());
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(device => device.kind === "audioinput" && device.deviceId);
}

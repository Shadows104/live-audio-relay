/**
 * Rewrite the Opus parameters in an SDP so the codec carries stereo music at a
 * music bitrate, instead of WebRTC's defaults (mono, tuned for speech).
 * @param {string} sdp
 * @param {number} bitrate  Target average bitrate in bits per second.
 * @returns {string}
 */
export function tuneOpus(sdp, bitrate) {
  const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000[^\r\n]*/i);
  if (!rtpmap) return sdp;
  const payloadType = rtpmap[1];

  const wanted = {
    stereo: "1",
    "sprop-stereo": "1",
    maxaveragebitrate: String(bitrate),
    usedtx: "0"
  };
  const format = params => [...params].map(([key, value]) => `${key}=${value}`).join(";");

  const fmtp = new RegExp(`^a=fmtp:${payloadType} ([^\\r\\n]*)$`, "m");
  if (fmtp.test(sdp)) {
    return sdp.replace(fmtp, (_line, existing) => {
      const params = new Map(
        existing.split(";")
          .map(param => param.trim().split("="))
          .filter(([key]) => key)
      );
      for (const [key, value] of Object.entries(wanted)) params.set(key, value);
      return `a=fmtp:${payloadType} ${format(params)}`;
    });
  }
  return sdp.replace(rtpmap[0], `${rtpmap[0]}\r\na=fmtp:${payloadType} ${format(Object.entries(wanted))}`);
}

// Browser Echoprint fingerprinting using compiled WASM.
// Requires echoprint.js + echoprint.wasm served from the same origin.
// Build them with: cd echoprint-wasm && ./build.sh

import createEchoprint from "./echoprint.js";

let _mod;
async function getModule() {
  if (!_mod) _mod = await createEchoprint();
  return _mod;
}

// Decode echoprintstring -> array of code integers.
// Same format as Spotify's pre-computed echoprintstring: zlib + base64url.
async function decodeCodeString(epStr) {
  // base64url -> Uint8Array
  const b64 = epStr.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "===".slice((b64.length + 3) % 4);
  const binary = atob(padded);
  const compressed = Uint8Array.from(binary, (c) => c.charCodeAt(0));

  // zlib decompress ('deflate' = RFC 1950, which is what zlib produces)
  const ds = new DecompressionStream("deflate");
  const blob = new Blob([compressed]);
  const data = new Uint8Array(await new Response(blob.stream().pipeThrough(ds)).arrayBuffer());

  // parse little-endian (time: uint32, code: uint32) pairs — we only need code
  const view = new DataView(data.buffer);
  const codes = [];
  for (let i = 0; i + 7 < data.length; i += 8) {
    codes.push(view.getUint32(i + 4, true)); // bytes 4-7 = code
  }
  return codes;
}

// Fingerprint an AudioBuffer and return an array of Echoprint hash codes.
export async function fingerprint(audioBuffer) {
  const mod = await getModule();

  // Resample to 11025 Hz mono (what echoprint-codegen expects)
  const targetRate = 11025;
  const numSamples = Math.ceil(audioBuffer.duration * targetRate);
  const offCtx = new OfflineAudioContext(1, numSamples, targetRate);
  const src = offCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(offCtx.destination);
  src.start();
  const resampled = await offCtx.startRendering();
  const pcm = resampled.getChannelData(0);

  // Copy PCM into WASM heap
  const ptr = mod._malloc(pcm.length * 4);
  mod.HEAPF32.set(pcm, ptr >> 2);

  // Run Echoprint
  const epStr = mod.computeEchoprint(ptr, pcm.length);
  mod._free(ptr);

  if (!epStr) return [];
  return decodeCodeString(epStr);
}

import createEchoprint from './echoprint.mjs'

// the URL that we send fingerprints to for lookup
const URL_BACKEND = '/identify'

// audio is collected in chunks
const CHUNK_MS = 5000
const MAX_CHUNKS = 3

// Fingerprint an AudioBuffer and return the raw echoprintstring (base64url + zlib).
let mod
export async function fingerprint(audioBuffer) {
  mod ||= await createEchoprint()

  // Resample to 11025 Hz mono (what echoprint-codegen expects)
  const targetRate = 11025
  const numSamples = Math.ceil(audioBuffer.duration * targetRate)
  const offCtx = new OfflineAudioContext(1, numSamples, targetRate)
  const src = offCtx.createBufferSource()
  src.buffer = audioBuffer
  src.connect(offCtx.destination)
  src.start()
  const resampled = await offCtx.startRendering()
  const pcm = resampled.getChannelData(0)

  // Copy PCM into WASM heap
  const ptr = mod._malloc(pcm.length * 4)
  mod.HEAPF32.set(pcm, ptr >> 2)

  // Run Echoprint — returns echoprintstring (same format as Spotify's stored value)
  const epStr = mod.computeEchoprint(ptr, pcm.length)
  mod._free(ptr)

  return epStr || null
}

/// FRONTEND

const btn = document.getElementById('btn')
const status = document.getElementById('status')
const result = document.getElementById('result')
let active = false

btn.onclick = async () => {
  if (active) return
  active = true
  btn.disabled = true
  result.textContent = ''
  try {
    await run()
  } catch (err) {
    status.textContent = `Error: ${err.message}`
  }
  btn.disabled = false
  active = false
}

function run() {
  return new Promise(async (resolve, reject) => {
    status.textContent = 'Requesting mic...'
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      })
    } catch (err) {
      return reject(err)
    }

    const recorder = new MediaRecorder(stream)
    const chunks = []
    let busy = false

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      resolve()
    }
    recorder.onerror = (e) => {
      stream.getTracks().forEach((t) => t.stop())
      reject(e.error)
    }

    recorder.ondataavailable = async (e) => {
      if (e.data.size === 0) return
      chunks.push(e.data)
      if (busy) return
      busy = true

      status.textContent = `Identifying... (${chunks.length * (CHUNK_MS / 1000)}s)`

      try {
        const buf = await new Blob(chunks, {
          type: recorder.mimeType
        }).arrayBuffer()
        const ctx = new AudioContext()
        let audioBuffer
        try {
          audioBuffer = await ctx.decodeAudioData(buf.slice(0))
        } finally {
          ctx.close()
        }

        const fp = await fingerprint(audioBuffer)

        if (!fp) {
          busy = false
          return
        }

        const data = await fetch(URL_BACKEND, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fingerprint: fp })
        }).then((r) => r.json())

        if (data.error) {
          recorder.stop()
          console.error(data.error)
          status.textContent = 'Error'
          return
        }

        if (data.found) {
          recorder.stop()
          status.textContent = `Found! (${data.score} codes matched)`
          result.textContent = [data.title, data.artist, data.album].filter(Boolean).join('\n')
          return
        }

        if (chunks.length >= MAX_CHUNKS) {
          recorder.stop()
          status.textContent = 'Song not found — try again.'
          return
        }

        busy = false
        status.textContent = 'Still listening...'
      } catch (err) {
        recorder.stop()
        reject(err)
      }
    }

    status.textContent = 'Listening...'
    recorder.start(CHUNK_MS)
  })
}

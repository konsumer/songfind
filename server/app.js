import { Hono } from 'hono'
import duckdb from 'duckdb'
import { inflateSync } from 'zlib'

const { AUDIO_DB = `${import.meta.dirname}/../audio_analysis.duckdb`, META_DB = `${import.meta.dirname}/../meta.duckdb` } = process.env

const app = new Hono()

function query(conn, sql, params = []) {
  return new Promise((resolve, reject) => conn.all(sql, ...params, (err, rows) => (err ? reject(err) : resolve(rows))))
}

let audioConn
let metaConn

app.post('/identify', async (c) => {
  try {
    if (!audioConn) {
      audioConn = new duckdb.Database(AUDIO_DB).connect()
      await query(audioConn, ``)
    }
    if (!metaConn) {
      metaConn = new duckdb.Database(META_DB).connect()
      await query(metaConn, ``)
    }

    const { fingerprint } = await c.req.json()
    if (!fingerprint) throw new Error('fingerprint required')

    // Decode echoprintstring: base64url → zlib → (time, code) uint32 pairs
    const compressed = Buffer.from(fingerprint.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    const data = inflateSync(compressed)
    const codes = []
    for (let i = 0; i + 7 < data.length; i += 8) {
      codes.push(data.readUInt32LE(i + 4)) // bytes 4-7 = code
    }
    if (codes.length === 0) throw new Error('empty fingerprint')

    // Find the track whose codes overlap the most with the query
    const [match] = await query(
      audioConn,
      `SELECT track_id, COUNT(*) AS score
     FROM ep_index WHERE code IN (${codes.join(',')})
     GROUP BY track_id ORDER BY score DESC LIMIT 1`
    )
    if (!match) return c.json({ found: false })

    // Look up metadata
    const [track] = await query(
      metaConn,
      `SELECT t.name AS title, ar.name AS artist, al.name AS album
     FROM tracks t
     LEFT JOIN track_artists ta ON ta.track_rowid = t.rowid
     LEFT JOIN artists ar ON ar.rowid = ta.artist_rowid
     LEFT JOIN albums al ON al.rowid = t.album_rowid
     WHERE t.id = ? LIMIT 1`,
      [match.track_id]
    )

    return c.json({ found: true, score: match.score, ...(track || {}) })
  } catch (e) {
    return c.json({ found: false, error: e.message }, 400)
  }
})

export default app

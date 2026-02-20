import { Hono } from "hono";
import duckdb from "duckdb";

const AUDIO_DB = process.env.AUDIO_DB || "audio_analysis.duckdb";
const META_DB = process.env.META_DB || "meta.duckdb";

let _audio, _meta;
function audioConn() {
  if (!_audio) _audio = new duckdb.Database(AUDIO_DB).connect();
  return _audio;
}
function metaConn() {
  if (!_meta) _meta = new duckdb.Database(META_DB).connect();
  return _meta;
}
function query(conn, sql, params = []) {
  return new Promise((resolve, reject) =>
    conn.all(sql, ...params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
}

const app = new Hono();

app.post("/identify", async (c) => {
  const { codes } = await c.req.json();
  if (!Array.isArray(codes) || codes.length === 0) {
    return c.json({ error: "codes array required" }, 400);
  }

  // Find the track whose codes overlap the most with the query
  const [match] = await query(
    audioConn(),
    `SELECT track_id, COUNT(*) AS score
     FROM ep_index WHERE code IN (${codes.join(",")})
     GROUP BY track_id ORDER BY score DESC LIMIT 1`
  );
  if (!match) return c.json({ found: false });

  // Look up metadata
  const [track] = await query(
    metaConn(),
    `SELECT t.name AS title, ar.name AS artist, al.name AS album
     FROM tracks t
     LEFT JOIN track_artists ta ON ta.track_rowid = t.rowid
     LEFT JOIN artists ar ON ar.rowid = ta.artist_rowid
     LEFT JOIN albums al ON al.rowid = t.album_rowid
     WHERE t.id = ? LIMIT 1`,
    [match.track_id]
  );

  return c.json({ found: true, score: match.score, ...(track || {}) });
});

export default app;

This is a way to build an song-detection and lookup system from the [Anna'a Archive](https://annas-archive.li/) spotify data-dump. It does not include any proprietary data, itself, but allows you to build a useful interface to it.

## setup

There are a few steps, and we are dealing with huge files, so you may need to download a file, process it, delete, and move on (using qtorrent's download options to pull in each file 1-at-a-time, for example.) The basic idea is we are building a big duckdb database, with tables for track-info and fingerprinting.

You can get find torrents for this source-data [here](torrents/).

### audio-analysis

For song-detection, we use `audio_analysis` (hash: `afc275bcf57137317e22e296a5ee20af8000444f`.)

**Step 1** — create the table once (schema with unique constraint):

```sh
duckdb music.duckdb \
  "CREATE TABLE IF NOT EXISTS fingerprints (
     track_id       VARCHAR PRIMARY KEY,
     echoprintstring VARCHAR
   )"
```

**Step 2** — import each batch of `.jsonl` files (safe to re-run; duplicates are skipped):

```sh
zstd -d 00.jsonl.zst
duckdb music.duckdb \
  "INSERT INTO fingerprints
   SELECT meta.track_id, track.echoprintstring
   FROM read_json_auto('*.jsonl')
   ON CONFLICT DO NOTHING"
```

The JSON looks like this, so you may want other data from there, feel free to adjust your `INSERT` and `CREATE TABLE` to work better for you:

```json
{
  "meta": {
    "analyzer_version": "4.0.0",
    "platform": "Linux",
    "detailed_status": "OK",
    "status_code": 0,
    "timestamp": 1706577218,
    "analysis_time": 17.07422,
    "input_process": "libvorbisfile L+R 44100->22050",
    "track_id": "00BPzjkraKN2WauLYMFwzF"
  },
  "track": {
    "num_samples": 8138214,
    "duration": 369.08,
    "sample_md5": "",
    "offset_seconds": 0,
    "window_seconds": 0,
    "analysis_sample_rate": 22050,
    "analysis_channels": 1,
    "end_of_fade_in": 0.4244,
    "start_of_fade_out": 355.3466,
    "loudness": -9.868,
    "tempo": 116.019,
    "tempo_confidence": 0.861,
    "time_signature": 4,
    "time_signature_confidence": 0.892,
    "key": 2,
    "key_confidence": 0.925,
    "mode": 1,
    "mode_confidence": 0.663,
    "codestring": "BASE64 STRING",
    "code_version": 3.15,
    "echoprintstring": "BASE64 STRING",
    "echoprint_version": 4.12,
    "synchstring": "BASE64 STRING",
    "synch_version": 1,
    "rhythmstring": "BASE64 STRING",
    "rhythm_version": 1
  },
  "bars": [
    {
      "start": 344.11652,
      "duration": 0.11651,
      "confidence": 0.855,
      "loudness_start": -28.931,
      "loudness_max_time": 0.0266,
      "loudness_max": -14.97,
      "loudness_end": 0,
      "pitches": [0.22, 0.185, 0.109, 0.098, 0.449, 0.471, 0.88, 0.89, 0.986, 1, 0.615, 0.065],
      "timbre": [37.146, -57.257, -61.438, 63.936, -11.908, 3.527, 40.528, -52.782, 17.094, -9.003, 3.577, 2.815]
    }
  ]
}
```

`bars` is a huge array of audio-info, for example.

**Step 3** — build the inverted search index. The `echoprintstring` values are base64url + zlib, and DuckDB has no native `inflate()` SQL function, so this step needs Python:

```sh
python3 build_index.py music.duckdb
```

The script is minimal — it registers a single Python UDF for zlib decode and then lets DuckDB execute the rest as SQL (`unnest`, `CREATE TABLE`, `CREATE INDEX`).

### meta

There is a ton of great meta-data (like track/artist/album/etc) in `metadata` (hash: `4cc9ac59f807dc6bdf95f52ffc86f44272a361a7`.) The stuff we want is in `spotify_clean.sqlite3.zst`, but there is lots of other great info in there, so feel free to explore. You can use this as-is (it's sqlite3) but also it might be nice to put it in duckdb:

```sh
zstd -d spotify_clean.sqlite3.zst

duckdb music.duckdb "INSTALL sqlite; LOAD sqlite; ATTACH 'spotify_clean.sqlite3' AS src (TYPE SQLITE); CREATE TABLE album_images AS SELECT * FROM src.album_images; CREATE TABLE artist_genres AS SELECT * FROM src.artist_genres; CREATE TABLE available_markets AS SELECT * FROM src.available_markets; CREATE TABLE albums AS SELECT * FROM src.albums; CREATE TABLE artist_images AS SELECT * FROM src.artist_images; CREATE TABLE track_artists AS SELECT * FROM src.track_artists; CREATE TABLE artist_albums AS SELECT * FROM src.artist_albums; CREATE TABLE artists AS SELECT * FROM src.artists; CREATE TABLE tracks AS SELECT * FROM src.tracks;"

```

## WASM fingerprinter

The browser generates Echoprint fingerprints locally using the original C++ algorithm compiled to WebAssembly. You should not need to build this yourself, since I did it for you, but it works like this:

```sh
# requires Emscripten (https://emscripten.org) and Boost headers
# macOS: brew install emscripten boost
# Linux: apt install emscripten libboost-dev
npm run build
```

This produces `echoprint.mjs` + `echoprint.wasm` in the webroot, served statically by the server.

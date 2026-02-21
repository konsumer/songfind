This is a way to build an song-detection and lookup system from the [Anna'a Archive](https://annas-archive.li/) spotify data-dump. It does not include any proprietary data, itself, but allows you to build a useful interface to it.

## setup

There are a few steps, and we are dealing with huge files, so you may need to download a file, process it, delete, and move on (using qtorrent's download options to pull in each file 1-at-a-time, for example.) The basic idea is we are building 2 big duckdb files.

You can get find torrents for this source-data [here](torrents/).

### audio-analysis

For song-detection, we use `audio_analysis` (hash: `afc275bcf57137317e22e296a5ee20af8000444f`.)

It's a ton of json files, but we will just process 1, as an example:

```sh
zstd -d 00.jsonl.zst
./build_audio.py audio_analysis.duckdb *.jsonl
```

This will drop a lot of interesting fields, but it cuts the size way down (to just enough to do song-detection.) Feel free to grab other fields, if you want it.

### meta

There is a ton of great meta-data (like track/artist/album/etc) in `metadata` (hash: `4cc9ac59f807dc6bdf95f52ffc86f44272a361a7`.) The stuff we want is in `spotify_clean.sqlite3.zst`, but there is lots of other great info in there, so feel free to explore. You can use this as-is (it's sqlite3) but also it might be nice to put it in duckdb:

```sh
zstd -d spotify_clean.sqlite3.zst

duckdb meta.duckdb "INSTALL sqlite; LOAD sqlite; ATTACH 'spotify_clean.sqlite3' AS src (TYPE SQLITE); CREATE TABLE album_images AS SELECT * FROM src.album_images; CREATE TABLE artist_genres AS SELECT * FROM src.artist_genres; CREATE TABLE available_markets AS SELECT * FROM src.available_markets; CREATE TABLE albums AS SELECT * FROM src.albums; CREATE TABLE artist_images AS SELECT * FROM src.artist_images; CREATE TABLE track_artists AS SELECT * FROM src.track_artists; CREATE TABLE artist_albums AS SELECT * FROM src.artist_albums; CREATE TABLE artists AS SELECT * FROM src.artists; CREATE TABLE tracks AS SELECT * FROM src.tracks;"

```

## WASM fingerprinter

The browser generates Echoprint fingerprints locally using the original C++ algorithm compiled to WebAssembly. You should not need to build this yourself. Build it once:

```sh
# requires Emscripten (https://emscripten.org) and Boost headers
# macOS: brew install emscripten boost
# Linux: apt install emscripten libboost-dev
cd echoprint-wasm && ./build.sh
```

This produces `echoprint.mjs` + `echoprint.wasm` in the webroot, served statically by the server.

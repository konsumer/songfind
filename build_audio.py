#!/usr/bin/env python3

"""
Build Echoprint inverted index in DuckDB from Spotify audio analysis JSONL files.

Usage:
  python3 build_audio.py audio_analysis.duckdb file1.jsonl [file2.jsonl ...]
"""

import sys
import base64
import zlib
import struct
import duckdb


def decode_ep(ep):
    ep += "=" * (-len(ep) % 4)
    data = zlib.decompress(base64.urlsafe_b64decode(ep))
    n = len(data) // 8
    vals = struct.unpack(f"<{n * 2}I", data[: n * 8])
    return list(zip(vals[1::2], vals[::2]))  # (code, time)


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <output.duckdb> <file.jsonl> [file2.jsonl ...]")
        sys.exit(1)

    db_path = sys.argv[1]
    jsonl_files = sys.argv[2:]

    con = duckdb.connect(db_path)
    con.execute("""
        CREATE TABLE IF NOT EXISTS ep_index (
            code     UINTEGER,
            time     UINTEGER,
            track_id VARCHAR
        )
    """)

    for jsonl_file in jsonl_files:
        print(f"Processing {jsonl_file}...")
        rows = []
        n_tracks = 0
        n_codes = 0

        with open(jsonl_file, "rbU") as f:
            count_all_lines = sum(1 for _ in f)

        count_current_lines = 0

        for track_id, ep in con.execute(
            "SELECT meta.track_id, track.echoprintstring FROM read_json_auto(?)",
            [jsonl_file],
        ).fetchall():
            count_current_lines = count_current_lines + 1
            print(f"{count_current_lines} / {count_all_lines}")
            
            try:
                pairs = decode_ep(ep)
            except Exception as e:
                print(f"  [warn] {track_id}: {e}")
                continue

            for c, t in pairs:
                rows.append((c, t, track_id))
            n_tracks += 1
            n_codes += len(pairs)

            if len(rows) >= 1_000_000:
                con.executemany("INSERT INTO ep_index VALUES (?, ?, ?)", rows)
                rows = []
                print(f"  {n_tracks} tracks, {n_codes:,} codes...", end="\r")

        if rows:
            con.executemany("INSERT INTO ep_index VALUES (?, ?, ?)", rows)

        print(f"  {jsonl_file}: {n_tracks} tracks, {n_codes:,} codes        ")

    print("Creating index on code...")
    con.execute("CREATE INDEX IF NOT EXISTS ep_index_code ON ep_index (code)")
    print("Done.")


if __name__ == "__main__":
    main()

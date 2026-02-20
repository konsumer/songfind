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

    # Enable DuckDB's native progress bar
    con.execute("SET enable_progress_bar = true")

    # Create table with optimized settings
    con.execute("""
        CREATE TABLE IF NOT EXISTS ep_index (
            code     UINTEGER,
            time     UINTEGER,
            track_id VARCHAR
        )
    """)

    # Optimize for bulk inserts
    con.execute("SET threads=4")
    con.execute("SET memory_limit='4GB'")

    for jsonl_file in jsonl_files:
        print(f"\nProcessing {jsonl_file}...")
        print("Reading JSON file...")

        rows = []
        n_tracks = 0
        n_codes = 0
        n_errors = 0

        # DuckDB will show progress bar for this query
        result = con.execute(
            "SELECT meta.track_id, track.echoprintstring FROM read_json_auto(?)",
            [jsonl_file],
        ).fetchall()

        print(f"Processing {len(result):,} tracks...")

        for i, (track_id, ep) in enumerate(result):
            try:
                pairs = decode_ep(ep)
            except Exception as e:
                n_errors += 1
                print(f"  [warn] {track_id}: {e}")
                continue

            for c, t in pairs:
                rows.append((c, t, track_id))
            n_tracks += 1
            n_codes += len(pairs)

            # Show progress every 10k tracks
            if (i + 1) % 10000 == 0:
                print(f"  {n_tracks:,} tracks, {n_codes:,} codes...", end="\r")

            # Batch insert every 1M rows for better performance
            if len(rows) >= 1_000_000:
                con.executemany("INSERT INTO ep_index VALUES (?, ?, ?)", rows)
                rows = []

        # Insert remaining rows
        if rows:
            con.executemany("INSERT INTO ep_index VALUES (?, ?, ?)", rows)

        print(f"✓ {jsonl_file}: {n_tracks:,} tracks, {n_codes:,} codes" +
              (f", {n_errors} errors" if n_errors > 0 else ""))

    print("\nCreating index on code...")
    con.execute("CREATE INDEX IF NOT EXISTS ep_index_code ON ep_index (code)")

    # Show final statistics
    stats = con.execute("SELECT COUNT(DISTINCT track_id) as tracks, COUNT(*) as codes FROM ep_index").fetchone()
    print(f"✓ Index complete: {stats[0]:,} unique tracks, {stats[1]:,} total codes")
    print("Done.")


if __name__ == "__main__":
    main()

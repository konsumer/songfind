#!/usr/bin/env python3
"""
Build Echoprint inverted index from the fingerprints table.

DuckDB can import the raw fingerprints from JSONL purely in SQL, but decoding
the echoprintstring (base64url + zlib) requires Python — there is no inflate()
in DuckDB SQL. This script registers a DuckDB UDF for that one step and lets
DuckDB handle the rest in SQL.

Usage:
  python3 build_index.py audio_analysis.duckdb
"""

import sys, base64, zlib, struct, duckdb

def decode_ep(ep):
    data = zlib.decompress(base64.urlsafe_b64decode(ep + '=='))
    vals = struct.unpack_from(f'<{len(data) // 4}I', data)
    return list(vals[1::2])  # every other uint32 starting at index 1 = codes

con = duckdb.connect(sys.argv[1])
con.create_function('decode_ep', decode_ep, ['VARCHAR'], 'UINTEGER[]')

con.execute("DROP TABLE IF EXISTS ep_index")
con.execute("CREATE TABLE ep_index (code UINTEGER, track_id VARCHAR)")
con.execute("INSERT INTO ep_index SELECT unnest(decode_ep(echoprintstring)) AS code, track_id FROM fingerprints")
con.execute("CREATE INDEX ep_idx ON ep_index (code)")

n = con.execute("SELECT COUNT(*) FROM ep_index").fetchone()[0]
print(f"Done: {n:,} codes indexed")

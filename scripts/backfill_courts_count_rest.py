#!/usr/bin/env python3
"""
backfill_courts_count_rest.py — Écrit venue.courts_count via l'API REST (PATCH).

Pourquoi ce script (et pas la migration 0023) : 0023 est *trackée appliquée*
côté remote mais le SQL n'a jamais écrit (statement_timeout sur l'UPDATE de
masse ; SET LOCAL n'a pas survécu au mode d'exécution du CLI). Vérifié en prod
le 2026-06-02 : échantillon 1000 venues → 996 NULL, max=1. Le backfill n'a
jamais atterri.

Approche robuste, sans connexion DB brute :
  1. Charge les venues publiées (keyset pagination) via REST.
  2. Calcule courts_count = taille du groupe (city_id, family_slug, adresse
     normalisée) — logique identique à backfill_courts_count.compute_courts_counts.
  3. Écrit par PATCH groupés PAR VALEUR : pour chaque n, PATCH des lots d'ids
     (id=in.(…)) → courts_count=n. PATCH = UPDATE (pas d'INSERT → pas de
     contrainte slug), filtré par PK → rapide, sous le statement_timeout.

Idempotent : ne PATCH que les venues dont courts_count diffère de la valeur
calculée. Relançable sans risque.

Usage :
  python3 scripts/backfill_courts_count_rest.py --max-writes 50    # test (paliers)
  python3 scripts/backfill_courts_count_rest.py                    # full apply
"""
from __future__ import annotations
import argparse, json, sys, time, unicodedata, urllib.request, urllib.error
from collections import defaultdict
from pathlib import Path


# ─── logique pure (identique à backfill_courts_count.py, inlinée) ────────────
def normalize_address(addr):
    if not addr:
        return None
    s = unicodedata.normalize("NFKD", addr).encode("ascii", "ignore").decode()
    s = " ".join(s.lower().split())
    return s or None


def group_key(v):
    addr = normalize_address(v.get("address"))
    if addr is None:
        return None
    return (v.get("city_id"), v.get("family_slug"), addr)


def compute_courts_counts(venues):
    groups = defaultdict(list)
    for v in venues:
        k = group_key(v)
        if k is None:
            continue
        groups[k].append(v["id"])
    out = {}
    for ids in groups.values():
        for vid in ids:
            out[vid] = len(ids)
    return out


def load_env():
    env = {}
    for line in open(Path(__file__).resolve().parent.parent / ".env.local"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    url = env["NEXT_PUBLIC_SUPABASE_URL"]
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    return url.rstrip("/"), key


def req(url, key, method="GET", path="", body=None, prefer=None, rng=None, timeout=120, retries=5):
    headers = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json"}
    if prefer: headers["Prefer"] = prefer
    if rng: headers["Range"] = rng
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(retries):
        try:
            r = urllib.request.Request(url + "/rest/v1/" + path, data=data,
                                       headers=headers, method=method)
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.headers, resp.read()
        except urllib.error.HTTPError as e:
            # 4xx (sauf 429/timeout) = erreur déterministe → ne pas réessayer.
            if e.code not in (408, 429, 500, 502, 503, 504):
                raise
            last = e
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
        time.sleep(min(2 ** attempt, 20))  # backoff: 1,2,4,8,16
    raise last


def fetch_all_venues(url, key):
    rows, last_id, page = [], "", 1000
    while True:
        path = (f"venue?select=id,address,city_id,family_slug,courts_count"
                f"&is_published=eq.true&deleted_at=is.null&order=id.asc&limit={page}")
        if last_id:
            path += f"&id=gt.{last_id}"
        _, raw = req(url, key, path=path)
        chunk = json.loads(raw)
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if len(rows) % 50000 < page:
            print(f"    … {len(rows):,} venues chargées", flush=True)
    return rows


def patch_ids(url, key, ids, n):
    # PATCH venue SET courts_count=n WHERE id IN (...). Lot par PK → rapide.
    id_list = ",".join(ids)
    path = f"venue?id=in.({id_list})"
    req(url, key, method="PATCH", path=path, body={"courts_count": n},
        prefer="return=minimal")


def verify(url, key, sample=4000):
    """Contrôle lecture seule : sur un échantillon de venues publiées, combien
    sont remplies, NULL-sans-adresse (normal) vs NULL-AVEC-adresse (= trous)."""
    rows, last_id, page = [], "", 1000
    while len(rows) < sample:
        path = (f"venue?select=id,courts_count,address&is_published=eq.true"
                f"&deleted_at=is.null&order=id.asc&limit={page}")
        if last_id:
            path += f"&id=gt.{last_id}"
        _, raw = req(url, key, path=path)
        chunk = json.loads(raw)
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if len(chunk) < page:
            break
    pos = null_no_addr = null_with_addr = 0
    for r in rows:
        has_addr = bool((r.get("address") or "").strip())
        if r["courts_count"] is None:
            null_with_addr += has_addr
            null_no_addr += (not has_addr)
        else:
            pos += 1
    print(f"🔎 VERIFY — échantillon={len(rows)}")
    print(f"   remplis (>=1)              : {pos}")
    print(f"   NULL sans adresse (normal) : {null_no_addr}")
    print(f"   NULL AVEC adresse (TROUS)  : {null_with_addr}")
    print("   ✅ complet" if null_with_addr == 0 else "   ⚠ trous restants → relancer le full")
    return null_with_addr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-writes", type=int, default=None,
                    help="Cap le nombre de venues écrites (test/paliers)")
    ap.add_argument("--chunk", type=int, default=120, help="ids par PATCH")
    ap.add_argument("--verify", action="store_true",
                    help="Contrôle lecture seule (taux de remplissage + trous), n'écrit rien")
    args = ap.parse_args()

    url, key = load_env()
    if args.verify:
        sys.exit(1 if verify(url, key) else 0)
    print(f"▶ backfill courts_count via REST {'(TEST max-writes=%d)' % args.max_writes if args.max_writes else '(FULL)'}")
    print("  ⏳ chargement venues publiées…", flush=True)
    venues = fetch_all_venues(url, key)
    print(f"  ✓ {len(venues):,} venues chargées", flush=True)

    counts = compute_courts_counts(venues)
    current = {v["id"]: v.get("courts_count") for v in venues}
    # Regroupe les ids à écrire par valeur cible (uniquement si différent de l'actuel).
    by_value = defaultdict(list)
    for vid, n in counts.items():
        if current.get(vid) != n:
            by_value[n].append(vid)
    total_to_write = sum(len(v) for v in by_value.values())
    print(f"  · venues à (ré)écrire : {total_to_write:,}")
    print(f"  · distribution cible  : " +
          ", ".join(f"{n}→{len(ids):,}" for n, ids in sorted(by_value.items())[:8]) + " …")

    written, t0 = 0, time.time()
    stop = False
    for n in sorted(by_value):
        ids = by_value[n]
        for i in range(0, len(ids), args.chunk):
            batch = ids[i:i + args.chunk]
            if args.max_writes and written + len(batch) > args.max_writes:
                batch = batch[: args.max_writes - written]
                stop = True
            if not batch:
                break
            patch_ids(url, key, batch, n)
            written += len(batch)
            if written % 24000 < args.chunk:
                rate = written / max(time.time() - t0, 1e-9)
                print(f"    … {written:,}/{total_to_write:,} écrites ({rate:,.0f}/s)", flush=True)
            if stop:
                break
        if stop:
            break
    dt = time.time() - t0
    print(f"  ✅ {written:,} venues écrites en {dt:.1f}s")
    if args.max_writes:
        print("  (test/palier — relancer sans --max-writes pour le full)")


if __name__ == "__main__":
    main()

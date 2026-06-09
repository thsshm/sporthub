#!/usr/bin/env python3
"""
backfill_primary_sport.py — déduit `venue.primary_sport_slug` quand il est NULL.

Problème : ~7-9 % des venues ont `primary_sport_slug` NULL (vérifié via l'API
carte : 68/1000 à Paris, 75/789 à Lyon). Les pages /[sport]/[pays]/[ville]
filtrent sur `primary_sport_slug` → ces venues n'apparaissent sur AUCUNE page
sport, alors qu'elles ont souvent un (ou des) sport(s) dans `venue_sport`.

Fix : pour chaque venue publiée à `primary_sport_slug` NULL, promouvoir un sport
de `venue_sport` comme primaire (priorité is_primary, puis le plus de courts,
puis le 1er). On ne touche QUE les NULL → idempotent. On NE modifie PAS
`family_slug` (la page ne le filtre pas) — cohérence famille = chantier séparé.

Dry-run par défaut (chiffre le scope) ; --apply pour écrire. Pattern d'écriture
groupée par valeur (cf. backfill_courts_count_rest.py #274).

Env (GitHub Actions) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Stdlib only.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


# ── Logique pure (testée) ───────────────────────────────────────────────────────
def derive_primary_sport(venue_sports: list[dict]) -> str | None:
    """Sport à promouvoir primaire. Priorité : is_primary, puis +de courts, puis
    1er. None si aucun sport exploitable."""
    cands = [vs for vs in (venue_sports or []) if vs.get("sport_slug")]
    if not cands:
        return None
    primary = [vs for vs in cands if vs.get("is_primary")]
    if primary:
        return primary[0]["sport_slug"]
    cands.sort(key=lambda vs: -(vs.get("courts_count") or 0))
    return cands[0]["sport_slug"]


def plan_primary(venues: list[dict]) -> dict[str, str]:
    """{venue_id: sport_slug} pour les venues réparables (pur, testable)."""
    out: dict[str, str] = {}
    for v in venues:
        sport = derive_primary_sport(v.get("venue_sport") or [])
        if sport:
            out[v["id"]] = sport
    return out


# ── REST Supabase (service-role) ────────────────────────────────────────────────
def load_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    f = Path(__file__).resolve().parent.parent / ".env.local"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    url = (os.getenv("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
           or env.get("SUPABASE_URL", ""))
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants", file=sys.stderr)
        raise SystemExit(1)
    return url.rstrip("/"), key


def req(url, key, method="GET", path="", body=None, prefer=None, timeout=120, retries=5):
    headers = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(retries):
        try:
            r = urllib.request.Request(url + "/rest/v1/" + path, data=data,
                                       headers=headers, method=method)
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code not in (408, 429, 500, 502, 503, 504):
                raise
            last = e
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
        time.sleep(min(2 ** attempt, 20))
    raise last


def fetch_null_primary(url, key, limit=None) -> list[dict]:
    """Venues publiées, non supprimées, primary_sport_slug NULL, + leur
    venue_sport embarqué (sport_slug, is_primary, courts_count)."""
    rows, last_id, page = [], "", 1000
    while True:
        path = (
            "venue?select=id,venue_sport(sport_slug,is_primary,courts_count)"
            "&primary_sport_slug=is.null&is_published=eq.true&deleted_at=is.null"
            f"&order=id.asc&limit={page}"
        )
        if last_id:
            path += f"&id=gt.{last_id}"
        chunk = json.loads(req(url, key, path=path))
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if limit and len(rows) >= limit:
            return rows[:limit]
        if len(rows) % 20000 < page:
            print(f"    … {len(rows):,} venues NULL chargées", flush=True)
        if len(chunk) < page:
            break
    return rows


def apply_primary(url, key, assignments: dict[str, str], chunk=120) -> int:
    """PATCH groupés PAR sport : venue?id=in.(ids) SET primary_sport_slug=<sport>."""
    by_sport: dict[str, list[str]] = {}
    for vid, sport in assignments.items():
        by_sport.setdefault(sport, []).append(vid)
    written = 0
    for sport, ids in by_sport.items():
        for i in range(0, len(ids), chunk):
            batch = ids[i:i + chunk]
            path = f"venue?id=in.({','.join(batch)})"
            req(url, key, method="PATCH", path=path,
                body={"primary_sport_slug": sport}, prefer="return=minimal")
            written += len(batch)
    return written


# ── Pipeline ────────────────────────────────────────────────────────────────────
def run(args: argparse.Namespace) -> int:
    url, key = load_env()
    print("▶ chargement des venues sans primary_sport_slug…")
    venues = fetch_null_primary(url, key, limit=args.limit)
    print(f"  ✓ {len(venues):,} venues à primary_sport NULL")

    assignments = plan_primary(venues)
    n = len(assignments)
    unfixable = len(venues) - n
    dist = collections.Counter(assignments.values())
    print(f"\n  réparables (≥1 sport dans venue_sport) : {n:,}")
    print(f"  non réparables (aucun venue_sport)       : {unfixable:,}")
    print(f"  sports promus (top) : {dict(dist.most_common(12))}")

    if args.apply:
        written = apply_primary(url, key, assignments, chunk=args.chunk)
        print(f"\n✅ APPLY — {written:,} venues ont reçu un primary_sport_slug.")
    else:
        print("\n✅ DRY-RUN — aucune écriture. Relancer avec --apply pour écrire.")
    return 0


def self_test() -> int:
    # is_primary prioritaire
    assert derive_primary_sport([
        {"sport_slug": "padel", "is_primary": False, "courts_count": 9},
        {"sport_slug": "tennis", "is_primary": True, "courts_count": 1},
    ]) == "tennis"
    # sinon le plus de courts
    assert derive_primary_sport([
        {"sport_slug": "padel", "is_primary": False, "courts_count": 2},
        {"sport_slug": "tennis", "is_primary": False, "courts_count": 8},
    ]) == "tennis"
    # sinon le premier ; ignore les entrées sans slug ; None si vide
    assert derive_primary_sport([{"sport_slug": "yoga"}, {"sport_slug": None}]) == "yoga"
    assert derive_primary_sport([]) is None
    assert derive_primary_sport([{"is_primary": True}]) is None  # pas de slug

    plan = plan_primary([
        {"id": "v1", "venue_sport": [{"sport_slug": "tennis", "is_primary": True}]},
        {"id": "v2", "venue_sport": []},   # non réparable
        {"id": "v3", "venue_sport": [{"sport_slug": "padel", "courts_count": 3}]},
    ])
    assert plan == {"v1": "tennis", "v3": "padel"}, plan
    print("✓ backfill_primary_sport self-test OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Déduit primary_sport_slug NULL depuis venue_sport")
    p.add_argument("--apply", action="store_true", help="Écrit en DB (sinon dry-run)")
    p.add_argument("--limit", type=int, default=None, help="Cap venues (smoke test)")
    p.add_argument("--chunk", type=int, default=120, help="ids par PATCH")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())

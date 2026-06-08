#!/usr/bin/env python3
"""
restore_soft_deleted.py — Annule des soft-deletes ciblés (deleted_at → NULL).

Outil de maintenance pour réparer un soft-delete erroné (ex. incident combat
#494 : un fetch Overpass incomplet a fait supprimer 47 venues existantes).

SÉCURITÉ / blast-radius borné :
  - `--family`, `--source` et `--since` (timestamp ISO) sont TOUS obligatoires.
    On ne peut donc pas annuler tout l'historique de soft-deletes d'un coup.
  - Dry-run par défaut : compte + échantillon, aucune écriture sans `--apply`.
  - `--max` (défaut 1000) : refus si le nombre de lignes ciblées dépasse ce cap
    (garde-fou contre un filtre trop large).

Auth : SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env ou .env.local). En CI, via
les secrets du repo — aucun secret n'est lu/écrit par l'appelant.

Exemples :
  python3 scripts/etl/restore_soft_deleted.py \\
      --family combat --source osm --country FR \\
      --since 2026-06-08T16:00:00Z --dry-run
  python3 scripts/etl/restore_soft_deleted.py \\
      --family combat --source osm --country FR \\
      --since 2026-06-08T16:00:00Z --apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _load_env() -> tuple[str, str]:
    """URL + service-role key depuis l'env (CI) ou .env.local (local)."""
    env: dict[str, str] = {}
    env_file = _REPO_ROOT / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    url = (env.get("NEXT_PUBLIC_SUPABASE_URL")
           or os.getenv("SUPABASE_URL")
           or os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""))
    key = (env.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    if not url or not key:
        print("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants", file=sys.stderr)
        raise SystemExit(1)
    return url.rstrip("/"), key


def _filter(args: argparse.Namespace) -> str:
    """Construit le filtre PostgREST (lignes soft-deletées à restaurer)."""
    parts = [
        f"family_slug=eq.{urllib.parse.quote(args.family)}",
        f"source=eq.{urllib.parse.quote(args.source)}",
        f"deleted_at=gte.{urllib.parse.quote(args.since)}",
        "deleted_at=not.is.null",
    ]
    if args.country:
        parts.append(f"country_code=eq.{urllib.parse.quote(args.country)}")
    return "&".join(parts)


def _headers(key: str, extra: dict | None = None) -> dict:
    h = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def count_targets(url: str, key: str, flt: str) -> int:
    req = urllib.request.Request(
        f"{url}/rest/v1/venue?select=id&{flt}",
        headers=_headers(key, {"Prefer": "count=exact", "Range": "0-0"}),
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        cr = resp.headers.get("content-range", "")
    # format "0-N/TOTAL" ou "*/TOTAL"
    return int(cr.split("/")[-1]) if "/" in cr else 0


def restore(url: str, key: str, flt: str) -> int:
    body = json.dumps({"deleted_at": None, "updated_at": "now()"}).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/venue?{flt}",
        data=body,
        headers=_headers(key, {"Prefer": "return=representation"}),
        method="PATCH",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        rows = json.loads(resp.read() or b"[]")
    return len(rows)


def main() -> int:
    p = argparse.ArgumentParser(description="Annule des soft-deletes ciblés.")
    p.add_argument("--family", required=True, help="family_slug (obligatoire)")
    p.add_argument("--source", required=True, help="source, ex. osm (obligatoire)")
    p.add_argument("--since", required=True,
                   help="ISO timestamp : ne restaure que deleted_at >= since (obligatoire)")
    p.add_argument("--country", default=None, help="country_code ISO-2 (optionnel)")
    p.add_argument("--max", type=int, default=1000,
                   help="garde-fou : refuse si plus de N lignes ciblées (défaut 1000)")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="écrit réellement")
    mode.add_argument("--dry-run", action="store_true", help="défaut : aucune écriture")
    args = p.parse_args()

    url, key = _load_env()
    flt = _filter(args)
    scope = f"{args.family}/{args.source}" + (f"/{args.country}" if args.country else "")
    print(f"▶ restore soft-deleted · {scope} · deleted_at>={args.since}")

    n = count_targets(url, key, flt)
    print(f"  cibles (deleted_at non null, dans la fenêtre) : {n}")
    if n == 0:
        print("  ✓ rien à restaurer.")
        return 0
    if n > args.max:
        print(f"❌ {n} > --max {args.max} : filtre trop large, abandon "
              f"(resserre --since / --country, ou augmente --max si volontaire).",
              file=sys.stderr)
        return 1

    if not args.apply:
        print(f"  ✓ [DRY-RUN] {n} venues seraient restaurées (deleted_at→NULL). "
              f"Relance avec --apply pour écrire.")
        return 0

    restored = restore(url, key, flt)
    print(f"  ✓ {restored} venues restaurées (deleted_at→NULL).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

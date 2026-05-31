#!/usr/bin/env python3
"""
backfill_surface_osm.py — Peuple venue_sport.surface depuis les tags OSM
déjà stockés dans venue.enrichments. Issue #223.

Contexte :
  Le filtre Surface (#99, PR #221) est livré et fonctionnel, MAIS
  venue_sport.surface est NULL en prod → le filtre renvoie 0 partout.
  La donnée existe pourtant déjà : import_v1.py a stocké le tag OSM `surface`
  dans venue.enrichments :
    - spots  : enrichments.surface  = "<valeur OSM>"        (string)
    - clubs  : enrichments.surfaces = ["<v1>", "<v2>", …]   (liste)
  Pas besoin de re-scraper OSM/Overpass : on lit l'enrichments en base, on
  mappe la valeur OSM vers nos 6 surfaces canoniques, et on remplit
  venue_sport.surface. 100 % côté DB.

Mapping OSM → canonique (KNOWN_SURFACES de app/api/venues/route.ts) :
  clay, concrete, synthetic, grass, parquet, sand.
On choisit le mapping OSM→canonique côté backfill → AUCUN changement du code
V2 (#99) ni des chips UI / i18n (cf. issue, option recommandée).

Idempotent : ne touche que les venue_sport dont la surface est NULL (ou
--force pour réécrire). Relançable.

Usage :
    pip install --break-system-packages supabase python-dotenv
    python3 scripts/backfill_surface_osm.py --self-test          # valide le mapping (sans DB)
    python3 scripts/backfill_surface_osm.py --limit 500 --dry-run # lecture seule, report
    python3 scripts/backfill_surface_osm.py                        # backfill réel
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Iterable

# ─── Mapping OSM → surface canonique ─────────────────────────────────────
# Valeurs OSM réelles (wiki OSM key:surface + tags terrains de sport) → nos 6.
# None = on n'a pas de correspondance fiable → on laisse NULL (pas de faux
# positif : mieux vaut « inconnu » qu'une surface erronée dans le filtre).
SURFACE_MAP: dict[str, str | None] = {
    # Terre battue
    "clay": "clay",
    # Dur (béton / enrobé / résine sur dalle) → concrete
    "hard": "concrete",
    "concrete": "concrete",
    "asphalt": "concrete",
    "paving_stones": "concrete",
    "acrylic": "concrete",
    "bitumen": "concrete",
    # Gazon naturel
    "grass": "grass",
    # Synthétique (gazon artificiel, tartan, caoutchouc, résine sportive)
    "synthetic": "synthetic",
    "artificial_turf": "synthetic",
    "synthetic_turf": "synthetic",
    "tartan": "synthetic",
    "rubber": "synthetic",
    "astroturf": "synthetic",
    # Parquet / bois / moquette (indoor)
    "parquet": "parquet",
    "wood": "parquet",
    "carpet": "parquet",
    # Sable
    "sand": "sand",
    # Ambigus / non pertinents → NULL (on n'invente pas)
    "ground": None,
    "dirt": None,
    "earth": None,
    "gravel": None,
    "fine_gravel": None,
    "unpaved": None,
    "paved": None,
    "metal": None,
}


def map_surface(raw: object) -> str | None:
    """Mappe une valeur OSM (string) vers une surface canonique, ou None.

    Tolère : casse, espaces, valeurs multiples « clay;hard » (1er token),
    valeurs non-string (None, nombres) → None.
    """
    if not isinstance(raw, str):
        return None
    val = raw.strip().lower()
    if not val:
        return None
    # OSM autorise « clay;hard » (plusieurs surfaces) → on prend la 1re connue.
    for token in val.split(";"):
        token = token.strip()
        mapped = SURFACE_MAP.get(token)
        if mapped is not None:
            return mapped
    return None


def surface_from_enrichments(enrichments: dict | None) -> str | None:
    """Extrait une surface canonique depuis enrichments (spots ou clubs).

    spots → enrichments['surface'] (string) ; clubs → enrichments['surfaces']
    (liste). On retourne la 1re surface canonique trouvée.
    """
    if not isinstance(enrichments, dict):
        return None
    single = map_surface(enrichments.get("surface"))
    if single:
        return single
    surfaces = enrichments.get("surfaces")
    if isinstance(surfaces, list):
        for s in surfaces:
            mapped = map_surface(s)
            if mapped:
                return mapped
    return None


# ─── Self-test du mapping (sans DB) ──────────────────────────────────────
def self_test() -> int:
    cases = {
        "clay": "clay",
        "Clay ": "clay",
        "hard": "concrete",
        "asphalt": "concrete",
        "acrylic": "concrete",
        "grass": "grass",
        "artificial_turf": "synthetic",
        "tartan": "synthetic",
        "carpet": "parquet",
        "wood": "parquet",
        "sand": "sand",
        "clay;hard": "clay",
        "gravel;clay": "clay",  # 1re connue
        "gravel": None,
        "ground": None,
        "": None,
        "totally_unknown": None,
    }
    failed = 0
    for raw, expected in cases.items():
        got = map_surface(raw)
        if got != expected:
            failed += 1
            print(f"  ✗ map_surface({raw!r}) = {got!r}, attendu {expected!r}")
    # surface_from_enrichments
    assert surface_from_enrichments({"surface": "clay"}) == "clay"
    assert surface_from_enrichments({"surfaces": ["gravel", "hard"]}) == "concrete"
    assert surface_from_enrichments({"surfaces": []}) is None
    assert surface_from_enrichments({}) is None
    assert surface_from_enrichments(None) is None
    # cible = sous-ensemble des 6 canoniques
    canon = {"clay", "concrete", "synthetic", "grass", "parquet", "sand"}
    assert set(v for v in SURFACE_MAP.values() if v) <= canon
    if failed:
        print(f"❌ self-test : {failed} cas en échec")
        return 1
    print(f"✅ self-test OK ({len(cases)} cas map_surface + enrichments + cibles canoniques)")
    return 0


# ─── Backfill (DB) ───────────────────────────────────────────────────────
def run_backfill(args: argparse.Namespace) -> int:
    try:
        from supabase import create_client
        from dotenv import load_dotenv
    except ImportError:
        print("❌ pip install --break-system-packages supabase python-dotenv", file=sys.stderr)
        return 1

    load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
    load_dotenv()
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("❌ Définir NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local)", file=sys.stderr)
        return 1
    sb = create_client(url, key)

    print(f"▶ Backfill venue_sport.surface depuis enrichments "
          f"({'DRY-RUN' if args.dry_run else 'LIVE'}{', FORCE' if args.force else ''})")

    page, page_size = 0, 1000
    seen = updated = no_surface = already = 0
    dist: dict[str, int] = {}

    while True:
        rows = (
            sb.table("venue")
            .select("id, enrichments")
            .is_("deleted_at", "null")
            .range(page * page_size, page * page_size + page_size - 1)
            .execute()
            .data
        )
        if not rows:
            break
        for v in rows:
            seen += 1
            surface = surface_from_enrichments(v.get("enrichments"))
            if not surface:
                no_surface += 1
                continue
            dist[surface] = dist.get(surface, 0) + 1
            if args.dry_run:
                continue
            # Cible : les venue_sport de ce venue, surface NULL (sauf --force).
            q = sb.table("venue_sport").update({"surface": surface}).eq("venue_id", v["id"])
            if not args.force:
                q = q.is_("surface", "null")
            res = q.execute()
            n = len(res.data or [])
            if n:
                updated += n
            else:
                already += 1
        if args.limit and seen >= args.limit:
            break
        page += 1

    print(f"\n  Venues scannés     : {seen:,}")
    print(f"  Avec surface OSM   : {sum(dist.values()):,}  {dict(sorted(dist.items()))}")
    print(f"  Sans surface       : {no_surface:,}")
    if args.dry_run:
        pct = 100 * sum(dist.values()) / seen if seen else 0
        print(f"\n  🔎 DRY-RUN — {pct:.1f}% des venues ont une surface mappable. Rien écrit.")
    else:
        print(f"  venue_sport mis à jour : {updated:,}  (déjà remplis/none : {already:,})")
    print("✅ Terminé.")
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Backfill venue_sport.surface depuis OSM/enrichments (#223)")
    p.add_argument("--self-test", action="store_true", help="Valide le mapping sans DB")
    p.add_argument("--dry-run", action="store_true", help="Lecture seule : report distribution")
    p.add_argument("--force", action="store_true", help="Réécrit même les surfaces déjà remplies")
    p.add_argument("--limit", type=int, default=None, help="Cap le nb de venues scannés (test)")
    args = p.parse_args(list(argv) if argv is not None else None)
    if args.self_test:
        return self_test()
    return run_backfill(args)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
generate_venue_tiles.py — Pipeline de tuiles vectorielles PMTiles des venues.

Issue #226 (Roadmap scalabilité, Phase 1.A). Découple le rendu carte de
Postgres : au lieu de fetcher des points via /api/venues à chaque pan/zoom
(coût O(volume), plafonne ~10-50k pts/viewport), on pré-rend TOUS les venues
en tuiles vectorielles (coût O(1) côté carte, quel que soit le volume).

Pipeline (3 étapes) :
  1. Export Postgres → GeoJSONL  (ce script, mode --geojson / défaut)
  2. GeoJSONL → venues.pmtiles    (tippecanoe ; lancé par ce script si dispo)
  3. Upload venues.pmtiles → object storage + CDN, puis MapLibre lit pmtiles://
     (étape ops + frontend, hors de ce script — cf. README en fin de run)

Ce premier jet livre les étapes 1-2 (génération). L'intégration MapLibre
(pmtiles://) et l'upload sont des suites (#226).

Dépendances :
  pip install --break-system-packages supabase python-dotenv
  brew install tippecanoe        # (ou apt/build) — requis pour l'étape 2

Usage :
    python3 scripts/generate_venue_tiles.py --self-test          # valide le builder GeoJSON (sans DB)
    python3 scripts/generate_venue_tiles.py --geojson            # export GeoJSONL seul (étape 1)
    python3 scripts/generate_venue_tiles.py                       # étapes 1+2 → venues.pmtiles
    python3 scripts/generate_venue_tiles.py --from-geojson f.jsonl  # étape 2 seule depuis un GeoJSONL

Format de sortie : un layer `venues`, un point par venue, une SEULE propriété
`fam` (family_slug) pour styler par famille + filtrer — slug/name/sport droppés
pour rester sous le plafond d'upload (50 Mo, plan gratuit ; détails au clic via
l'API, pas depuis la tuile). GeoJSONL
(line-delimited) plutôt que FeatureCollection : tippecanoe le lit en streaming,
indispensable pour des centaines de milliers de venues sans saturer la RAM.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable, Iterator

DEFAULT_GEOJSONL = "venues.geojsonl"
DEFAULT_PMTILES = "venues.pmtiles"
TILE_LAYER = "venues"

# Bornes de zoom des tuiles :
#   -Z2  : à partir du zoom 2 (vue ~continentale) — inutile de tuiler le globe entier
#   -z14 : jusqu'au zoom 14 (rue) — au-delà, MapLibre sur-zoome la tuile z14
MIN_ZOOM = 2
MAX_ZOOM = 14


# ─── Étape 1 : venue row → Feature GeoJSON ───────────────────────────────


def venue_to_feature(row: dict) -> dict | None:
    """Convertit une ligne venue (dict) en Feature GeoJSON Point, ou None si
    coordonnées invalides. Propriétés volontairement minimales (poids tuile)."""
    lat, lon = row.get("lat"), row.get("lon")
    if not _is_lonlat(lon, lat):
        return None
    props: dict[str, object] = {}
    # SEULE propriété embarquée : `fam` (family_slug) — c'est la seule lue par
    # la carte (couleur par famille + filtre familles, cf. lib/map/venue-tiles.ts).
    # On NE met PLUS slug/name/sport : ce sont des chaînes UNIQUES (donc non
    # dédupliquées dans la string-table des tuiles) qui pesaient ~80 % du poids
    # → 77 Mo, au-dessus du plafond d'upload Supabase (50 Mo, plan gratuit). Le
    # clic/popup étant hors scope de l'intégration tuiles actuelle, les infos
    # détaillées (nom, slug…) restent servies par l'API au clic. Si un jour on
    # rend le clic depuis les tuiles, ré-ajouter `slug` ici et régénérer.
    if row.get("family_slug"):
        props["fam"] = row["family_slug"]
    return {
        "type": "Feature",
        # GeoJSON = [lon, lat] (x, y) — piège classique, lat/lon inversés sinon.
        "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
        "properties": props,
    }


def _is_lonlat(lon: object, lat: object) -> bool:
    return (
        isinstance(lon, (int, float))
        and isinstance(lat, (int, float))
        and not isinstance(lon, bool)
        and -180 <= lon <= 180
        and -90 <= lat <= 90
        and not (lon == 0 and lat == 0)  # Null Island = placeholder
    )


def features_to_geojsonl(rows: Iterable[dict]) -> Iterator[str]:
    """Stream de lignes GeoJSONL (une Feature compacte par ligne)."""
    for row in rows:
        feat = venue_to_feature(row)
        if feat is not None:
            yield json.dumps(feat, separators=(",", ":"), ensure_ascii=False)


# ─── Étape 1 (live) : export depuis Supabase ─────────────────────────────


def export_geojsonl(out_path: Path, limit: int | None) -> int:
    try:
        from supabase import create_client
        from dotenv import load_dotenv
    except ImportError:
        print("❌ pip install --break-system-packages supabase python-dotenv", file=sys.stderr)
        sys.exit(1)
    load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
    load_dotenv()
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("❌ Définir NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local)", file=sys.stderr)
        sys.exit(1)
    sb = create_client(url, key)

    written = 0
    page_size = 1000
    # Pagination KEYSET (curseur sur `id`) et non OFFSET : `.range(page*size, …)`
    # devient O(offset) — chaque page re-scanne tous les enregistrements sautés,
    # donc les pages profondes ralentissent jusqu'à dépasser le statement_timeout
    # Postgres (57014) à mesure que la table venue grossit (≈370k). Le keyset
    # `WHERE id > <dernier_id> ORDER BY id LIMIT size` garde un coût constant par
    # page (seek sur l'index PK), indépendamment de la profondeur.
    last_id: str | None = None
    with out_path.open("w", encoding="utf-8") as fh:
        while True:
            q = (
                sb.table("venue")
                .select("id, lat, lon, family_slug")
                .eq("is_published", True)
                .is_("deleted_at", "null")
                .order("id")
                .limit(page_size)
            )
            if last_id is not None:
                q = q.gt("id", last_id)
            rows = q.execute().data
            if not rows:
                break
            for line in features_to_geojsonl(rows):
                fh.write(line + "\n")
                written += 1
            # Avance le curseur sur le dernier id LU (pas la dernière feature
            # écrite : certaines lignes sont droppées par venue_to_feature).
            last_id = rows[-1]["id"]
            print(f"  …{written:,} features", end="\r", file=sys.stderr)
            if limit and written >= limit:
                break
    print(f"\n  ✓ {written:,} features écrites → {out_path}")
    return written


# ─── Étape 2 : GeoJSONL → PMTiles (tippecanoe) ───────────────────────────


def build_tippecanoe_cmd(geojsonl: Path, pmtiles: Path) -> list[str]:
    return [
        "tippecanoe",
        "-o", str(pmtiles),
        "-l", TILE_LAYER,
        "-Z", str(MIN_ZOOM),
        "-z", str(MAX_ZOOM),
        # Aux zooms bas, trop de points par tuile → on laisse tippecanoe en
        # dropper (densité) plutôt que dépasser la taille de tuile. La densité
        # visuelle reste représentative ; le clustering fin se fera côté carte.
        "--drop-densest-as-needed",
        "--extend-zooms-if-still-dropping",
        # Coalesce des points identiques → tuiles plus légères.
        "--coalesce-densest-as-needed",
        "--force",  # écrase un .pmtiles existant
    ]


def run_tippecanoe(geojsonl: Path, pmtiles: Path) -> int:
    if shutil.which("tippecanoe") is None:
        print(
            "⚠ tippecanoe introuvable — étape 2 sautée.\n"
            "  Installer : brew install tippecanoe  (ou build depuis felt/tippecanoe)\n"
            f"  Puis : python3 scripts/generate_venue_tiles.py --from-geojson {geojsonl}",
            file=sys.stderr,
        )
        return 2
    cmd = build_tippecanoe_cmd(geojsonl, pmtiles)
    cmd.append(str(geojsonl))
    print(f"  ▶ {' '.join(cmd)}")
    proc = subprocess.run(cmd)
    if proc.returncode == 0:
        size_mb = pmtiles.stat().st_size / 1e6
        print(f"  ✓ {pmtiles} généré ({size_mb:.1f} Mo)")
    return proc.returncode


# ─── Self-test (sans DB ni tippecanoe) ───────────────────────────────────


def self_test() -> int:
    # Feature valide
    f = venue_to_feature(
        {"slug": "tennis-paris", "name": "Tennis Paris", "lat": 48.8566, "lon": 2.3522,
         "family_slug": "raquette", "primary_sport_slug": "tennis"}
    )
    assert f and f["geometry"]["coordinates"] == [2.3522, 48.8566], f  # [lon, lat]
    # Seule `fam` est embarquée (slug/name/sport droppés pour le poids tuile).
    assert f["properties"] == {"fam": "raquette"}, f
    # Coords invalides / Null Island → None
    assert venue_to_feature({"lat": None, "lon": 2.0}) is None
    assert venue_to_feature({"lat": 0, "lon": 0}) is None
    assert venue_to_feature({"lat": 91, "lon": 2}) is None
    assert venue_to_feature({"lat": 48, "lon": 200}) is None
    # Une venue sans family_slug → properties vide (mais Feature valide)
    f2 = venue_to_feature({"lat": 1.0, "lon": 1.0, "name": "X"})
    assert f2 and f2["properties"] == {}, f2
    # GeoJSONL stream filtre les invalides
    lines = list(features_to_geojsonl([
        {"family_slug": "raquette", "lat": 48.0, "lon": 2.0},
        {"family_slug": "ballon", "lat": None, "lon": None},
        {"family_slug": "ballon", "lat": 45.0, "lon": 5.0},
    ]))
    assert len(lines) == 2, lines
    assert all(json.loads(ln)["type"] == "Feature" for ln in lines)
    # Commande tippecanoe bien formée
    cmd = build_tippecanoe_cmd(Path("in.jsonl"), Path("out.pmtiles"))
    assert cmd[0] == "tippecanoe" and "-o" in cmd and "out.pmtiles" in cmd
    assert "-l" in cmd and TILE_LAYER in cmd
    print("✅ self-test OK (venue_to_feature, GeoJSONL stream, commande tippecanoe)")
    return 0


def print_next_steps(pmtiles: Path) -> None:
    print(
        "\n── Suite (#226) ──────────────────────────────────────────────\n"
        f"  3. Upload {pmtiles} sur object storage + CDN :\n"
        "     - Supabase Storage (bucket public 'tiles') ou Cloudflare R2 / S3.\n"
        "  4. Frontend MapLibre (suite #226, fichier app/[locale]/map/MapClient.tsx) :\n"
        "     npm i pmtiles\n"
        "     import { Protocol } from 'pmtiles';\n"
        "     maplibregl.addProtocol('pmtiles', new Protocol().tile);\n"
        "     source: { type:'vector', url:'pmtiles://<CDN>/venues.pmtiles' }\n"
        "     → remplace le fetch /api/venues pour l'affichage des pins.\n"
        "  5. Régénération nightly (cron) sur changement data.\n"
        "  /api/venues reste pour la liste + la recherche.\n"
    )


def main(argv: Iterable[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Génère les tuiles vectorielles PMTiles des venues (#226)")
    p.add_argument("--self-test", action="store_true", help="Valide le builder GeoJSON sans DB")
    p.add_argument("--geojson", action="store_true", help="Étape 1 seule : export GeoJSONL")
    p.add_argument("--from-geojson", metavar="FILE", help="Étape 2 seule : tuile depuis un GeoJSONL")
    p.add_argument("--out", default=DEFAULT_PMTILES, help="Fichier .pmtiles de sortie")
    p.add_argument("--geojsonl-out", default=DEFAULT_GEOJSONL, help="Fichier GeoJSONL intermédiaire")
    p.add_argument("--limit", type=int, default=None, help="Cap le nb de venues (test)")
    args = p.parse_args(list(argv) if argv is not None else None)

    if args.self_test:
        return self_test()

    pmtiles = Path(args.out)
    if args.from_geojson:
        return run_tippecanoe(Path(args.from_geojson), pmtiles)

    geojsonl = Path(args.geojsonl_out)
    print(f"▶ Étape 1 : export venues → {geojsonl}")
    n = export_geojsonl(geojsonl, args.limit)
    if n == 0:
        print("⚠ Aucune venue exportée — abandon.", file=sys.stderr)
        return 1
    if args.geojson:
        print("  (--geojson : étape 2 tippecanoe sautée)")
        return 0
    print(f"▶ Étape 2 : {geojsonl} → {pmtiles}")
    rc = run_tippecanoe(geojsonl, pmtiles)
    if rc == 0:
        print_next_steps(pmtiles)
    return rc


if __name__ == "__main__":
    sys.exit(main())

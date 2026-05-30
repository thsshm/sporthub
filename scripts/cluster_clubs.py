#!/usr/bin/env python3
"""
cluster_clubs.py — Regroupe les venues en clubs et popule venue.club_id.

Cette migration batch est le follow-up de la PR #130 (table `club` +
colonne `venue.club_id` nullable créées par migration 0012). La table
`club` reste vide et `venue.club_id` reste NULL jusqu'à ce que ce script
soit exécuté.

Algorithme (simplifié par rapport au V1 SQLite)
───────────────────────────────────────────────
Pour chaque famille cible, on récupère les venues via l'API REST Supabase,
puis on applique deux critères de clustering en séquence (via Union-Find) :

  1. Géo ≤ 50 m (haversine) + similarité de nom :
       a. Nom identique normalisé (exact match après strip/lower/accents)
       b. Prefix commun ≥ 8 chars
       c. ≥ 2 tokens significatifs (≥ 4 chars) en commun
  2. Fallback géo pur ≤ 50 m si les deux venues n'ont pas de nom significatif
     ou si leurs noms sont « génériques » (court 1, terrain…).

Un cluster = 1 row `club` (INSERT, ON CONFLICT DO NOTHING sur slug) +
UPDATE venue SET club_id = <uuid> WHERE club_id IS NULL.
L'opération est donc idempotente : elle peut être ré-exécutée sans dupliquer.

Familles ciblées (club-compatible)
────────────────────────────────────
  raquette, fitness, hike, baignade, yoga, combat, glisse

Dépendances : stdlib Python uniquement (urllib, json, math, argparse, …).
Pas de supabase-py ni de requests — conforme à la règle "deps-free" du CLAUDE.md.

Usage
─────
  # Dry-run (défaut) :
    python3 scripts/cluster_clubs.py \\
      --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"

  # Dry-run famille spécifique :
    python3 scripts/cluster_clubs.py --family raquette \\
      --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"

  # Dry-run avec limite N venues (smoke test) :
    python3 scripts/cluster_clubs.py --limit 200 \\
      --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"

  # Écriture réelle (Gautier) :
    python3 scripts/cluster_clubs.py --no-dry-run \\
      --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"

Issue : https://github.com/thsshm/sporthub/issues/130 (follow-up)
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from typing import Any

# ─── Familles ciblées ─────────────────────────────────────────────────────────

CLUB_FAMILIES: list[str] = [
    "raquette",
    "fitness",
    "hike",
    "baignade",
    "yoga",
    "combat",
    "glisse",
]

# ─── Grille spatiale ──────────────────────────────────────────────────────────

# Cellule de ~200 m = 0.002° lat/lon (approximation suffisante pour 50-100 m).
_GRID_DEG = 0.002


def _grid_key(lat: float, lon: float) -> tuple[int, int]:
    return (int(lat / _GRID_DEG), int(lon / _GRID_DEG))


# ─── Helpers géo ──────────────────────────────────────────────────────────────

_R = 6_371_000.0  # rayon Terre en mètres


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance haversine en mètres entre deux points WGS-84."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    )
    return 2 * _R * math.asin(math.sqrt(a))


# ─── Helpers texte ────────────────────────────────────────────────────────────


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def normalize_name(name: str | None) -> str:
    """Normalise un nom : minuscules, sans accents, sans ponctuation, espaces compressés."""
    if not name:
        return ""
    s = name.lower()
    s = _strip_accents(s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def slugify(s: str) -> str:
    """Transforme un texte en slug ASCII (kebab-case)."""
    s = normalize_name(s)
    s = s.replace(" ", "-")
    s = re.sub(r"-{2,}", "-", s)
    return s[:64].strip("-") or "x"


_GENERIC_NAMES: frozenset[str] = frozenset({
    "",
    "court", "courts", "terrain", "terrains", "pitch", "ground",
    "court 1", "court 2", "court 3", "court 4",
    "terrain 1", "terrain 2", "terrain 3",
    "salle", "gymnase", "complexe sportif",
    "court de tennis", "terrain de tennis",
    "tennis", "padel", "badminton", "squash", "ping pong", "pingpong",
    "piscine", "plage", "yoga", "gym", "fitness",
})


def is_generic(name: str | None) -> bool:
    if not name:
        return True
    n = normalize_name(name)
    return n in _GENERIC_NAMES or len(n) < 4


def names_similar(a: str | None, b: str | None) -> bool:
    """Retourne True si les deux noms normalisés sont suffisamment proches."""
    if is_generic(a) or is_generic(b):
        return False
    na, nb = normalize_name(a), normalize_name(b)
    if na == nb:
        return True
    if len(na) >= 8 and len(nb) >= 8 and na[:8] == nb[:8]:
        return True
    toks_a = {t for t in na.split() if len(t) >= 4}
    toks_b = {t for t in nb.split() if len(t) >= 4}
    return len(toks_a & toks_b) >= 2


# ─── Union-Find ───────────────────────────────────────────────────────────────


class UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]  # path compression
            x = self.parent[x]
        return x

    def union(self, x: int, y: int) -> bool:
        rx, ry = self.find(x), self.find(y)
        if rx == ry:
            return False
        if self.rank[rx] < self.rank[ry]:
            rx, ry = ry, rx
        self.parent[ry] = rx
        if self.rank[rx] == self.rank[ry]:
            self.rank[rx] += 1
        return True


# ─── Clustering ───────────────────────────────────────────────────────────────


def cluster_venues(venues: list[dict[str, Any]], radius_m: float = 50.0) -> UnionFind:
    """Applique le clustering par proximité + similarité de nom.

    Passe 1 : fusionne si distance <= radius_m ET noms similaires.
    Passe 2 : fallback géo pur (<= radius_m) si aucun des deux clusters
              n'a de nom significatif distinctif.
    """
    n = len(venues)
    uf = UnionFind(n)

    # Grille spatiale pour éviter O(N²)
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, v in enumerate(venues):
        grid[_grid_key(v["lat"], v["lon"])].append(i)

    def neighbors(idx: int) -> list[int]:
        v = venues[idx]
        lat, lon = v["lat"], v["lon"]
        cell_lat, cell_lon = _grid_key(lat, lon)
        span = int(math.ceil(radius_m / 111_000 / _GRID_DEG)) + 1
        out: list[int] = []
        for dl in range(-span, span + 1):
            for dn in range(-span, span + 1):
                for j in grid.get((cell_lat + dl, cell_lon + dn), ()):
                    if j != idx and haversine_m(lat, lon, venues[j]["lat"], venues[j]["lon"]) <= radius_m:
                        out.append(j)
        return out

    # Passe 1 : géo + similarité nom
    for i in range(n):
        if is_generic(venues[i].get("name")):
            continue
        for j in neighbors(i):
            if uf.find(i) == uf.find(j):
                continue
            if names_similar(venues[i].get("name"), venues[j].get("name")):
                uf.union(i, j)

    # Passe 2 : fallback géo pur (uniquement si les deux clusters sont sans nom distinctif)
    # Précalcule les racines qui ont au moins un nom significatif
    roots_with_name: set[int] = set()
    for i in range(n):
        if not is_generic(venues[i].get("name")):
            roots_with_name.add(uf.find(i))

    for i in range(n):
        for j in neighbors(i):
            ri, rj = uf.find(i), uf.find(j)
            if ri == rj:
                continue
            if ri in roots_with_name and rj in roots_with_name:
                continue
            uf.union(i, j)
            # Met à jour roots_with_name après fusion
            new_root = uf.find(i)
            if ri in roots_with_name or rj in roots_with_name:
                roots_with_name.add(new_root)

    return uf


# ─── Construction des objets club ─────────────────────────────────────────────


def build_clubs(
    venues: list[dict[str, Any]],
    uf: UnionFind,
    family_slug: str,
) -> list[dict[str, Any]]:
    """Construit la liste des clubs à partir du résultat de clustering.

    Seuls les clusters de >= 2 venues génèrent un club (un venue isolé
    reste un pin individuel sans club parent).
    """
    members: dict[int, list[int]] = defaultdict(list)
    for i in range(len(venues)):
        members[uf.find(i)].append(i)

    clubs: list[dict[str, Any]] = []
    used_slugs: set[str] = set()

    for root, idxs in members.items():
        if len(idxs) < 2:
            continue

        grp = [venues[i] for i in idxs]

        # Nom du club : le plus fréquent parmi les noms significatifs
        sig_names = [v["name"] for v in grp if v.get("name") and not is_generic(v.get("name"))]
        if sig_names:
            club_name: str = Counter(sig_names).most_common(1)[0][0]
        else:
            club_name = family_slug.replace("_", " ").title()

        # Centroïde géographique
        lat = sum(v["lat"] for v in grp) / len(grp)
        lon = sum(v["lon"] for v in grp) / len(grp)

        # Métadonnées : première valeur non vide parmi les membres
        def first_val(key: str) -> Any:
            for v in grp:
                val = v.get(key)
                if val:
                    return val
            return None

        city_id: str | None = first_val("city_id")
        country_code: str | None = first_val("country_code")

        # Slug stable : family + pays + nom normalisé
        cc = (country_code or "xx").lower()
        name_slug = slugify(club_name)
        base_slug = f"{family_slug}-{cc}-{name_slug}"
        slug = base_slug
        idx_n = 2
        while slug in used_slugs:
            slug = f"{base_slug}-{idx_n}"
            idx_n += 1
        used_slugs.add(slug)

        clubs.append({
            "slug": slug,
            "name": club_name,
            "family_slug": family_slug,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "city_id": city_id,
            "country_code": country_code,
            # Clé interne, non envoyée à Supabase
            "_venue_ids": [v["id"] for v in grp],
        })

    return clubs


# ─── Supabase REST client ──────────────────────────────────────────────────────


class SupabaseRest:
    """Wrapper minimaliste sur l'API REST Supabase (PostgREST + auth).

    Opérations utilisées :
      GET  /venue   → lecture des venues par famille
      POST /club    → INSERT des clubs (ON CONFLICT DO NOTHING via Prefer)
      PATCH /venue  → UPDATE venue.club_id WHERE club_id IS NULL
    """

    def __init__(self, base_url: str, service_key: str, dry_run: bool = True) -> None:
        self.base = base_url.rstrip("/")
        self.key = service_key
        self.dry_run = dry_run

    def _headers(self, prefer: str | None = None) -> dict[str, str]:
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if prefer:
            h["Prefer"] = prefer
        return h

    def _req(
        self,
        method: str,
        path: str,
        body: Any = None,
        prefer: str | None = None,
    ) -> Any:
        url = f"{self.base}/rest/v1{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            url, data=data, method=method, headers=self._headers(prefer=prefer)
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else []
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            raise RuntimeError(f"Supabase {method} {path} → {exc.code}: {detail}") from exc

    # ── Lecture ─────────────────────────────────────────────────────────────

    def fetch_venues(
        self,
        family_slug: str,
        limit: int | None = None,
        page_size: int = 1000,
    ) -> list[dict[str, Any]]:
        """Récupère les venues d'une famille (pagination automatique)."""
        venues: list[dict[str, Any]] = []
        offset = 0
        select = "id,name,slug,lat,lon,city_id,country_code,club_id"
        while True:
            n = min(page_size, limit - len(venues)) if limit else page_size
            qs = urllib.parse.urlencode({
                "select": select,
                "family_slug": f"eq.{family_slug}",
                "deleted_at": "is.null",
                "limit": n,
                "offset": offset,
                "order": "id",
            })
            batch: list[dict[str, Any]] = self._req("GET", f"/venue?{qs}")
            if not batch:
                break
            venues.extend(batch)
            offset += len(batch)
            if len(batch) < n:
                break
            if limit and len(venues) >= limit:
                break
        if limit:
            venues = venues[:limit]
        return venues

    # ── Écriture ────────────────────────────────────────────────────────────

    def insert_club(self, club: dict[str, Any]) -> str | None:
        """INSERT club row idempotent. Retourne l'UUID (créé ou existant).

        ON CONFLICT (slug) DO NOTHING via Prefer: resolution=ignore-duplicates.
        Si la row existait déjà, on la re-fetch par slug pour obtenir l'UUID.
        """
        if self.dry_run:
            logging.getLogger(__name__).debug(
                "[dry-run] INSERT club slug=%r name=%r", club["slug"], club["name"]
            )
            return None

        payload = {k: v for k, v in club.items() if not k.startswith("_") and v is not None}
        try:
            rows: list[dict[str, Any]] = self._req(
                "POST",
                "/club",
                body=payload,
                prefer="return=representation,resolution=ignore-duplicates",
            )
        except RuntimeError as exc:
            # Fallback si ignore-duplicates non supporté : conflict 409
            if "409" in str(exc) or "23505" in str(exc):
                logging.getLogger(__name__).warning(
                    "insert_club conflit slug=%r — fetch UUID existant.", club["slug"]
                )
                return self._fetch_club_id_by_slug(club["slug"])
            raise

        if rows:
            return rows[0]["id"]
        # Aucune row retournée = conflit silencieux → re-fetch
        return self._fetch_club_id_by_slug(club["slug"])

    def _fetch_club_id_by_slug(self, slug: str) -> str | None:
        qs = urllib.parse.urlencode({"select": "id", "slug": f"eq.{slug}", "limit": 1})
        rows: list[dict[str, Any]] = self._req("GET", f"/club?{qs}")
        return rows[0]["id"] if rows else None

    def link_venues_to_club(self, venue_ids: list[str], club_id: str, batch_size: int = 50) -> int:
        """UPDATE venue SET club_id = club_id WHERE id IN (...) AND club_id IS NULL.

        Idempotent : n'écrase pas un club_id déjà positionné.
        Retourne le nombre de venues traités (pas forcément tous mis à jour
        si certains avaient déjà un club_id).
        """
        if self.dry_run:
            return 0
        for i in range(0, len(venue_ids), batch_size):
            chunk = venue_ids[i : i + batch_size]
            quoted = ",".join(chunk)
            qs = urllib.parse.urlencode({
                "id": f"in.({quoted})",
                "club_id": "is.null",
            })
            self._req(
                "PATCH",
                f"/venue?{qs}",
                body={"club_id": club_id},
                prefer="return=minimal",
            )
        return len(venue_ids)


# ─── Main ──────────────────────────────────────────────────────────────────────


def run(args: argparse.Namespace) -> int:
    logging.basicConfig(
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
        level=logging.DEBUG if args.verbose else logging.INFO,
    )
    log = logging.getLogger(__name__)

    if not args.supabase_url or not args.supabase_key:
        log.error(
            "--supabase-url et --supabase-key sont obligatoires "
            "(ou $SUPABASE_URL + $SUPABASE_SERVICE_ROLE_KEY)."
        )
        return 2

    is_dummy = args.supabase_url in ("dummy", "https://dummy") or args.supabase_url.startswith("https://dummy")
    if is_dummy and not args.dry_run:
        log.error("URL Supabase factice — impossible d'écrire. Utilisez une vraie URL avec --no-dry-run.")
        return 2

    sb = SupabaseRest(args.supabase_url, args.supabase_key, dry_run=args.dry_run)
    families = [args.family] if args.family else CLUB_FAMILIES

    total_venues = 0
    total_clusters = 0
    total_linked = 0

    for family in families:
        log.info("=== Famille : %s ===", family)

        # 1. Chargement des venues
        if is_dummy:
            log.info("[dummy] skip réseau — simulation 0 venues.")
            venues: list[dict[str, Any]] = []
        else:
            log.info("Chargement venues %s…", family)
            try:
                venues = sb.fetch_venues(family, limit=args.limit)
            except RuntimeError as exc:
                if args.dry_run:
                    log.warning("Erreur réseau ignorée (dry-run) : %s", exc)
                    venues = []
                else:
                    log.error("Erreur réseau : %s", exc)
                    return 1
        log.info("  %d venues chargées.", len(venues))
        total_venues += len(venues)

        if len(venues) < 2:
            log.info("  Trop peu de venues pour clustérer, skip.")
            continue

        # 2. Clustering
        log.info("Clustering %d venues (rayon 50 m)…", len(venues))
        uf = cluster_venues(venues, radius_m=50.0)

        # 3. Construction des clubs
        clubs = build_clubs(venues, uf, family)
        log.info("  %d clusters (>= 2 venues) détectés.", len(clubs))
        total_clusters += len(clubs)

        if args.dry_run and clubs:
            sample_n = min(5, len(clubs))
            log.info("--- Echantillon %d clusters ---", sample_n)
            for c in clubs[:sample_n]:
                log.info(
                    "  slug=%r  name=%r  lat=%.4f  lon=%.4f  venues=%d",
                    c["slug"], c["name"], c["lat"], c["lon"], len(c["_venue_ids"]),
                )

        # 4. Insert clubs + link venues
        family_linked = 0
        for club in clubs:
            venue_ids: list[str] = club["_venue_ids"]
            if args.dry_run:
                log.debug(
                    "[dry-run] club %r -> %d venues", club["slug"], len(venue_ids)
                )
                family_linked += len(venue_ids)
                continue

            club_id = sb.insert_club(club)
            if not club_id:
                log.warning("UUID introuvable pour club %r — skip link.", club["slug"])
                continue
            n_linked = sb.link_venues_to_club(venue_ids, club_id)
            family_linked += n_linked
            log.debug("Club %r : %d venues liées.", club["slug"], n_linked)

        total_linked += family_linked
        log.info(
            "  Famille %s : %d clusters, %d venues linkées.%s",
            family, len(clubs), family_linked,
            " [DRY-RUN]" if args.dry_run else "",
        )

    # Récap final
    log.info("=" * 50)
    log.info("Résumé global :")
    log.info("  Familles traitées    : %d", len(families))
    log.info("  Venues chargées      : %d", total_venues)
    log.info("  Clubs (clusters >=2) : %d", total_clusters)
    log.info("  Venues liées         : %d%s", total_linked, " (simulé)" if args.dry_run else "")
    if args.dry_run:
        log.info("DRY-RUN — aucune ecriture envoyee a Supabase.")
        log.info("Relancez avec --no-dry-run pour appliquer.")
    else:
        log.info("Termine.")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Cluster venues en clubs et popule venue.club_id (#130 follow-up).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Exemples
--------
  # Dry-run complet (defaut) :
    python3 scripts/cluster_clubs.py \\
      --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"

  # Dry-run une famille + limite :
    python3 scripts/cluster_clubs.py --family raquette --limit 500 \\
      --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"

  # Production (Gautier) :
    python3 scripts/cluster_clubs.py --no-dry-run \\
      --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"

  # Reinitialiser une famille avant re-run (Supabase Studio ou psql) :
    DELETE FROM club WHERE family_slug = 'raquette';
    UPDATE venue SET club_id = NULL WHERE family_slug = 'raquette';
""",
    )
    p.add_argument(
        "--supabase-url",
        default=os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL"),
        help="URL projet Supabase (ou $SUPABASE_URL).",
    )
    p.add_argument(
        "--supabase-key",
        default=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
        help="Service-role key Supabase (ou $SUPABASE_SERVICE_ROLE_KEY). JAMAIS la anon key.",
    )
    dry_group = p.add_mutually_exclusive_group()
    dry_group.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        default=True,
        help="(defaut) Simule sans ecrire en DB.",
    )
    dry_group.add_argument(
        "--no-dry-run",
        dest="dry_run",
        action="store_false",
        help="Ecriture reelle dans Supabase.",
    )
    p.add_argument(
        "--family",
        choices=CLUB_FAMILIES,
        default=None,
        help="Limite a une famille (defaut : toutes).",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limite N venues par famille (smoke test).",
    )
    p.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Log DEBUG.",
    )
    return p.parse_args(argv)


def main() -> int:
    args = parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())

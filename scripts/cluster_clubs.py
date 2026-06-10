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
import socket
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from typing import Any

# ─── Résilience HTTP ───────────────────────────────────────────────────────
# Le run réel fait des dizaines de milliers de requêtes REST séquentielles ;
# un timeout/5xx transitoire ne doit pas tuer tout le batch (cf. crash run
# raquette sur socket.timeout). Retry avec backoff linéaire.
_HTTP_TIMEOUT = 120
_MAX_RETRIES = 5
_BACKOFF_BASE = 2.0

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


# Mots de tête signalant un libellé d'équipement (et non un nom de club).
_COURT_LEAD: frozenset[str] = frozenset({
    "court", "courts", "kort", "terrain", "terrains", "piste", "pistes",
    "bassin", "bassins", "cours", "pitch", "ground", "field",
})


def is_subcourt_label(name: str | None) -> bool:
    """True pour les libellés de SOUS-COURT numérotés — pas un nom de club.

    Ex : « Court de tennis 3 », « Terrain n°5 », « Court de tennis B 2 »,
    « COURTS DE TENNIS EXTERIEURS (BETON) 9 ». Ces noms passent `is_generic`
    (absents de la liste figée, ≥ 4 chars) et devenaient donc des NOMS DE CLUB
    dans le ranking /disciplines (#497). Signal structurel : le nom normalisé
    commence par un mot d'équipement générique ET se termine par un nombre
    (éventuellement précédé d'une lettre ou de « n° »).
    """
    n = normalize_name(name)
    if not n or not re.search(r"\d\s*$", n):
        return False
    return n.split()[0] in _COURT_LEAD


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

        # Nom du club : le plus fréquent parmi les noms significatifs, en
        # EXCLUANT les étiquettes de sous-court numérotées (« Court de tennis 3 »)
        # — sinon un club finissait nommé d'après un de ses courts dans le
        # ranking /disciplines (#497).
        good_names = [
            v["name"]
            for v in grp
            if v.get("name")
            and not is_generic(v.get("name"))
            and not is_subcourt_label(v.get("name"))
        ]
        if good_names:
            club_name: str = Counter(good_names).most_common(1)[0][0]
        else:
            # Aucun vrai nom dispo : on prend le moins mauvais nom non générique
            # (le plus court = souvent le plus propre), sinon le nom de famille.
            fallback = [
                v["name"] for v in grp if v.get("name") and not is_generic(v.get("name"))
            ]
            club_name = (
                min(fallback, key=len) if fallback else family_slug.replace("_", " ").title()
            )

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
        last_exc: Exception | None = None
        for attempt in range(1, _MAX_RETRIES + 1):
            req = urllib.request.Request(
                url, data=data, method=method, headers=self._headers(prefer=prefer)
            )
            try:
                with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
                    raw = resp.read()
                    return json.loads(raw) if raw else []
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")
                # Retry sur 5xx transitoires (502/503/504) ET sur le
                # statement_timeout Postgres (HTTP 500 / code 57014), qui
                # survient sur les requêtes de chargement quand la DB est
                # sous charge. Les autres codes remontent immédiatement.
                transient = exc.code in (502, 503, 504) or (
                    exc.code == 500 and "57014" in detail
                )
                if transient and attempt < _MAX_RETRIES:
                    last_exc = exc
                    time.sleep(_BACKOFF_BASE * attempt)
                    continue
                raise RuntimeError(
                    f"Supabase {method} {path} → {exc.code}: {detail}"
                ) from exc
            except (socket.timeout, urllib.error.URLError, ConnectionError) as exc:
                # Timeout / coupure réseau → retry avec backoff.
                last_exc = exc
                if attempt < _MAX_RETRIES:
                    time.sleep(_BACKOFF_BASE * attempt)
                    continue
                raise RuntimeError(
                    f"Supabase {method} {path} → réseau (après {attempt} essais): {exc}"
                ) from exc
        raise RuntimeError(f"Supabase {method} {path} → échec inattendu: {last_exc}")

    # ── Lecture ─────────────────────────────────────────────────────────────

    def fetch_venues(
        self,
        family_slug: str,
        limit: int | None = None,
        page_size: int = 250,
    ) -> list[dict[str, Any]]:
        """Récupère les venues d'une famille (pagination keyset par id).

        On pagine en keyset (`id > dernier_id`) et NON en OFFSET : sur les
        familles denses (raquette ~47k, fitness…), `offset=47000` force
        Postgres à scanner/sauter 47k lignes par page → statement timeout
        (57014). Le keyset utilise l'index PK → O(1) par page, jamais de
        timeout. L'`id` est un UUID : l'ordre n'est pas chronologique mais
        total et stable, ce qui suffit pour une pagination exhaustive.
        """
        venues: list[dict[str, Any]] = []
        last_id: str | None = None
        select = "id,name,slug,lat,lon,city_id,country_code,club_id"
        while True:
            n = min(page_size, limit - len(venues)) if limit else page_size
            params = {
                "select": select,
                "family_slug": f"eq.{family_slug}",
                "deleted_at": "is.null",
                # On ne cluster que les venues publiés : c'est ce que compte
                # l'endpoint /api/venues/clubs (courts_count) et ce qui s'affiche
                # sur la carte. Clusteriser des venues non publiés créerait des
                # clubs fantômes ou un courts_count incohérent.
                "is_published": "eq.true",
                "limit": n,
                "order": "id.asc",
            }
            if last_id is not None:
                params["id"] = f"gt.{last_id}"
            qs = urllib.parse.urlencode(params)
            batch: list[dict[str, Any]] = self._req("GET", f"/venue?{qs}")
            if not batch:
                break
            venues.extend(batch)
            last_id = batch[-1]["id"]
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

    def reset_family(self, family_slug: str) -> None:
        """Vide les clubs d'une famille AVANT re-clustering (option --reset, #497).

        Ordre imposé par la FK venue.club_id → club.id :
          1. PATCH venue SET club_id = NULL WHERE family_slug = X
          2. DELETE club          WHERE family_slug = X
        Idempotent (relançable). En dry-run : log sans écrire.
        """
        log = logging.getLogger(__name__)
        if self.dry_run:
            log.info("[dry-run] reset %s : DELETE club + NULL venue.club_id", family_slug)
            return
        qs = urllib.parse.urlencode({"family_slug": f"eq.{family_slug}"})
        log.info("Reset %s : NULL venue.club_id…", family_slug)
        self._req("PATCH", f"/venue?{qs}", body={"club_id": None}, prefer="return=minimal")
        log.info("Reset %s : DELETE club…", family_slug)
        self._req("DELETE", f"/club?{qs}", prefer="return=minimal")

    def import_clubs_batched(
        self, clubs: list[dict[str, Any]], batch_size: int = 250
    ) -> int:
        """Écrit les clubs + liens venues côté serveur via le RPC import_clubs.

        Remplace l'ancienne boucle ~1 requête/club (insert + N liens) par
        ~1 appel RPC par lot de `batch_size` clubs : chaque appel insère le lot
        et lie ses venues en UNE transaction Postgres (migration 0032). Bien
        plus rapide et insensible aux statement_timeout par-ligne.

        Idempotent (ON CONFLICT slug + UPDATE … WHERE club_id IS NULL côté SQL).
        Le retry HTTP de `_req` rejoue un lot qui aurait time out (le rollback
        atomique de la fonction garantit l'absence d'écriture partielle).

        Retourne le total de venues liées (somme des `linked` renvoyés).
        """
        if self.dry_run:
            return sum(len(c["_venue_ids"]) for c in clubs)

        total_linked = 0
        for i in range(0, len(clubs), batch_size):
            batch = clubs[i : i + batch_size]
            payload = [
                {
                    "slug": c["slug"],
                    "name": c["name"],
                    "family_slug": c["family_slug"],
                    "lat": c["lat"],
                    "lon": c["lon"],
                    "city_id": c.get("city_id"),
                    "country_code": c.get("country_code"),
                    "venue_ids": c["_venue_ids"],
                }
                for c in batch
            ]
            res = self._req("POST", "/rpc/import_clubs", body={"p_clubs": payload})
            if isinstance(res, dict):
                total_linked += int(res.get("linked", 0) or 0)
        return total_linked


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

        # 0. Reset optionnel (--reset) : repart d'une base propre AVANT de
        # re-clusteriser. Indispensable pour RENOMMER des clubs déjà créés —
        # import_clubs est ON CONFLICT slug DO NOTHING (ne met pas à jour un club
        # existant) et venue.club_id n'est relié que s'il est NULL. Sans reset,
        # un re-run ne corrige donc pas les noms (#497).
        if args.reset and not is_dummy:
            sb.reset_family(family)

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

        # 4. Écriture batch côté serveur (RPC import_clubs, migration 0032) :
        # ~1 appel par lot de 250 clubs au lieu de ~1 requête par club.
        family_linked = sb.import_clubs_batched(clubs)
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
        "--reset",
        action="store_true",
        help="Avant de clusteriser, vide les clubs de la/les famille(s) ciblée(s) "
        "(DELETE club + NULL venue.club_id) pour repartir propre et RENOMMER les "
        "clubs existants (#497). Sans effet en dry-run.",
    )
    p.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Log DEBUG.",
    )
    p.add_argument(
        "--self-test",
        action="store_true",
        help="Teste la logique pure géo/texte/clustering (CI, sans creds ni DB).",
    )
    return p.parse_args(argv)


def self_test() -> int:
    """Tests de la logique pure (géo, texte, Union-Find, clustering). Sans DB
    ni creds → tourne en CI (le repo n'a pas d'infra pytest)."""

    # ── haversine_m ──────────────────────────────────────────────────────
    assert haversine_m(48.85, 2.35, 48.85, 2.35) == 0.0
    # 1° de latitude ≈ 111.2 km (tolérance large)
    assert abs(haversine_m(0.0, 0.0, 1.0, 0.0) - 111_195) < 100, haversine_m(0, 0, 1, 0)
    # ~111 m pour 0.001° de latitude
    assert abs(haversine_m(48.0, 2.0, 48.001, 2.0) - 111.2) < 2, haversine_m(48.0, 2.0, 48.001, 2.0)
    # symétrie
    assert haversine_m(48.0, 2.0, 49.0, 3.0) == haversine_m(49.0, 3.0, 48.0, 2.0)

    # ── normalize_name ───────────────────────────────────────────────────
    assert normalize_name(None) == ""
    assert normalize_name("  TENNIS   Club  ") == "tennis club"
    assert normalize_name("Café de l'Été!") == "cafe de l ete"

    # ── slugify ──────────────────────────────────────────────────────────
    assert slugify("Tennis Club de Paris") == "tennis-club-de-paris"
    assert slugify("") == "x"  # fallback
    assert slugify("Café!!!") == "cafe"

    # ── is_generic ───────────────────────────────────────────────────────
    assert is_generic(None) is True
    assert is_generic("Court 1") is True
    assert is_generic("tennis") is True       # nom de famille de sport seul
    assert is_generic("abc") is True          # < 4 chars
    assert is_generic("Tennis Club de Vincennes") is False

    # ── is_subcourt_label (#497) ──────────────────────────────────────────
    assert is_subcourt_label("Court de tennis 3") is True
    assert is_subcourt_label("Terrain tennis 4") is True
    assert is_subcourt_label("Court de tennis B 2") is True
    assert is_subcourt_label("Terrain n°5") is True
    assert is_subcourt_label("COURTS DE TENNIS EXTERIEURS (BETON) 9") is True
    assert is_subcourt_label("Tennis Club Baillargues") is False  # vrai club
    assert is_subcourt_label("La Croix-Catelan") is False
    assert is_subcourt_label("Stade Roland Garros") is False  # pas de nombre final

    # ── build_clubs : ignore les sous-courts pour nommer (#497) ───────────
    grp_v = [
        {"id": "a", "name": "Court de tennis 3", "lat": 48.0, "lon": 2.0, "city_id": None, "country_code": "FR"},
        {"id": "b", "name": "Court de tennis 4", "lat": 48.00001, "lon": 2.0, "city_id": None, "country_code": "FR"},
        {"id": "c", "name": "Tennis Club de Vincennes", "lat": 48.00002, "lon": 2.0, "city_id": None, "country_code": "FR"},
    ]
    uf_b = UnionFind(3)
    uf_b.union(0, 1)
    uf_b.union(0, 2)
    clubs_b = build_clubs(grp_v, uf_b, "raquette")
    assert len(clubs_b) == 1, clubs_b
    assert clubs_b[0]["name"] == "Tennis Club de Vincennes", clubs_b[0]["name"]

    # Cluster 100 % sous-courts → fallback sur le plus court, jamais un « N »
    grp_only_courts = [
        {"id": "a", "name": "Court de tennis 3", "lat": 48.0, "lon": 2.0, "city_id": None, "country_code": "FR"},
        {"id": "b", "name": "Court de tennis 4", "lat": 48.00001, "lon": 2.0, "city_id": None, "country_code": "FR"},
    ]
    uf_c = UnionFind(2)
    uf_c.union(0, 1)
    clubs_c = build_clubs(grp_only_courts, uf_c, "raquette")
    assert len(clubs_c) == 1, clubs_c

    # ── names_similar ────────────────────────────────────────────────────
    assert names_similar("Court 1", "Court 2") is False           # deux génériques
    assert names_similar("Aviron Club Lyon", "Aviron Club Lyon") is True  # égalité
    # préfixe commun ≥ 8 chars
    assert names_similar("Stade Roland Garros", "Stade Roland Garros Annexe") is True
    # ≥ 2 tokens (≥4 chars) communs, ordre différent
    assert names_similar("Club Nautique Lyon", "Lyon Club Aviron") is True
    # aucun chevauchement significatif
    assert names_similar("Padel Center Aaa", "Squash Place Bbb") is False

    # ── UnionFind ────────────────────────────────────────────────────────
    uf = UnionFind(5)
    assert all(uf.find(i) == i for i in range(5))
    assert uf.union(0, 1) is True
    assert uf.union(0, 1) is False            # déjà fusionnés
    assert uf.find(0) == uf.find(1)
    uf.union(1, 2)
    assert uf.find(0) == uf.find(2)           # transitivité
    assert uf.find(0) != uf.find(3)

    # ── cluster_venues (passe 1 : géo + nom) ─────────────────────────────
    v = [
        {"name": "Aviron Club Lyon", "lat": 45.7600, "lon": 4.8300},
        {"name": "Aviron Club Lyon", "lat": 45.76001, "lon": 4.83000},  # ~1 m, même nom
        {"name": "Karate Do Marseille", "lat": 43.3000, "lon": 5.4000},  # loin
    ]
    uf1 = cluster_venues(v)
    assert uf1.find(0) == uf1.find(1)         # fusionnés (proches + même nom)
    assert uf1.find(0) != uf1.find(2)         # séparés (loin)

    # ── cluster_venues (passe 2 : fallback géo pur sur noms génériques) ───
    v2 = [
        {"name": "Court 1", "lat": 10.0, "lon": 10.0},
        {"name": "Court 2", "lat": 10.00001, "lon": 10.0},  # ~1 m, deux génériques
    ]
    uf2 = cluster_venues(v2)
    assert uf2.find(0) == uf2.find(1)         # fusionnés via fallback géo

    print("✓ cluster_clubs self-test OK")
    return 0


def main() -> int:
    args = parse_args()
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())

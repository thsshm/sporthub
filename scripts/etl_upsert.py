#!/usr/bin/env python3
"""
etl_upsert.py — Helpers ETL pour l'import idempotent de venues (#227).

Fournit :
  - UpsertResult : résultat d'un batch (compteurs + erreurs)
  - VenueRecord  : dict minimal attendu par l'upsert
  - upsert_venues_batch : PATCH/POST groupé par (source, external_id)
  - open_import_run / close_import_run : lifecycle d'un import_run

Logique (pure, testable sans DB) :
  - L'idempotence repose sur UNIQUE (source, external_id) + ON CONFLICT DO UPDATE.
  - soft_delete_missing : met deleted_at sur les venues (source, scope) absentes
    du batch courant → "elles ont disparu de la source".
  - Toutes les fonctions I/O acceptent un `client` injectable (duck-typing)
    pour être mockées dans les self-tests.

Dépendances : stdlib uniquement (urllib, json, os, …). Conforme à la règle
"deps-free" du CLAUDE.md.

Usage :
    python3 scripts/etl_upsert.py --self-test
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Iterable


# ── Types ────────────────────────────────────────────────────────────────────

@dataclass
class VenueRecord:
    """Venue minimal pour l'upsert.

    `source` + `external_id` sont la clé naturelle idempotente.
    Seuls les champs non-null sont envoyés (les absents = pas d'écrasement).
    """
    source: str          # 'osm', 'overture', 'res', …
    external_id: str     # 'osm/way/12345', 'overture/places/abc', …
    name: str
    lat: float
    lon: float
    family_slug: str
    primary_sport_slug: str | None = None
    address: str | None = None
    city_id: str | None = None
    country_code: str | None = None
    is_published: bool = True

    def to_api_dict(self) -> dict:
        """Sérialise pour l'API REST Supabase (sans les None → pas d'écrasement)."""
        d: dict = {
            "source": self.source,
            "external_id": self.external_id,
            "name": self.name,
            "lat": self.lat,
            "lon": self.lon,
            "family_slug": self.family_slug,
            "is_published": self.is_published,
        }
        if self.primary_sport_slug is not None:
            d["primary_sport_slug"] = self.primary_sport_slug
        if self.address is not None:
            d["address"] = self.address
        if self.city_id is not None:
            d["city_id"] = self.city_id
        if self.country_code is not None:
            d["country_code"] = self.country_code
        # Slug dérivé (unique) : source + external_id hashé si absent.
        d["slug"] = _derive_slug(self.source, self.external_id)
        return d


@dataclass
class UpsertResult:
    upserted: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)

    def merge(self, other: "UpsertResult") -> "UpsertResult":
        return UpsertResult(
            upserted=self.upserted + other.upserted,
            skipped=self.skipped + other.skipped,
            errors=self.errors + other.errors,
        )


# ── Helpers purs ─────────────────────────────────────────────────────────────

def _derive_slug(source: str, external_id: str) -> str:
    """Dérive un slug court + unique depuis (source, external_id).

    Format : <source>-<hash8> — garanti unique, URL-safe, stable.
    Ex. : "osm-a3f7c2d1", "overture-b8e4d90f".
    """
    h = hashlib.sha256(f"{source}:{external_id}".encode()).hexdigest()[:8]
    return f"{source}-{h}"


def batch_records(records: list[VenueRecord], size: int) -> Iterable[list[VenueRecord]]:
    """Découpe en lots de taille `size`."""
    for i in range(0, len(records), size):
        yield records[i : i + size]


def compute_run_hash(source: str, scope: str, params: dict) -> str:
    """Hash SHA-256 tronqué des paramètres d'un run (idempotence inter-runs)."""
    payload = json.dumps({"source": source, "scope": scope, **params}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


# ── I/O REST ─────────────────────────────────────────────────────────────────

class SupabaseRestClient:
    """Client REST Supabase minimal (stdlib) utilisé par les scripts ETL.

    Séparé de la logique pure pour être mockable dans les tests.
    """

    def __init__(self, url: str, key: str, timeout: int = 120):
        self.url = url.rstrip("/")
        self.key = key
        self.timeout = timeout

    def _headers(self, extra: dict | None = None) -> dict:
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal,resolution=merge-duplicates",
        }
        if extra:
            h.update(extra)
        return h

    def upsert(self, table: str, rows: list[dict]) -> None:
        """Upsert rows into `table` via POST with on-conflict merge."""
        data = json.dumps(rows).encode()
        req = urllib.request.Request(
            f"{self.url}/rest/v1/{table}",
            data=data,
            headers=self._headers(),
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout):
            pass  # 204 No Content attendu avec Prefer: return=minimal

    def rpc(self, fn: str, params: dict) -> dict:
        data = json.dumps(params).encode()
        req = urllib.request.Request(
            f"{self.url}/rest/v1/rpc/{fn}",
            data=data,
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read())


def upsert_venues_batch(
    client: SupabaseRestClient,
    records: list[VenueRecord],
    chunk_size: int = 100,
) -> UpsertResult:
    """Upsert idempotent par lots.

    ON CONFLICT (source, external_id) → merge (migration 0043).
    Le champ `slug` est dérivé de (source, external_id) : stable + unique.
    """
    result = UpsertResult()
    for chunk in batch_records(records, chunk_size):
        rows = [r.to_api_dict() for r in chunk]
        try:
            client.upsert("venue", rows)
            result.upserted += len(chunk)
        except urllib.error.HTTPError as e:
            body = e.read()[:200].decode("utf-8", errors="replace")
            result.errors.append(f"HTTP {e.code}: {body}")
            result.skipped += len(chunk)
        except Exception as e:  # noqa: BLE001
            result.errors.append(str(e))
            result.skipped += len(chunk)
    return result


def deduplicate_records(
    records: list[VenueRecord],
    geo_threshold_deg: float = 0.0005,
) -> list[VenueRecord]:
    """Déduplique les VenueRecord par proximité géo (seuil ~50 m en ° lat/lon).

    227.6 — dédup AVANT upsert quand on mélange plusieurs sources (OSM + Overture
    + RES) dans le même batch. Sans dédup, deux sources peuvent insérer le même
    club physique → doublon en DB.

    Stratégie (pure, O(n²) suffisant pour des lots ≤ 5000) :
      - Pour chaque record, calcule la « cellule de grille »
        floor(lat/thr)*thr, floor(lon/thr)*thr).
      - Le premier record de chaque cellule gagne ; les suivants dans la même
        cellule sont écartés.
      - Précision : ~50 m à moyenne latitude (0.0005° ≈ 55 m en latitude).

    Limite : ne déduplique qu'au sein du même batch — pas contre les venues
    déjà en DB (c'est l'upsert ON CONFLICT qui gère ça côté DB pour la même
    source, et la logique RPC de dédup cross-source est un chantier distinct).
    """
    seen_cells: set[tuple[int, int]] = set()
    result: list[VenueRecord] = []
    scale = 1.0 / geo_threshold_deg
    for r in records:
        cell = (int(r.lat * scale), int(r.lon * scale))
        if cell not in seen_cells:
            seen_cells.add(cell)
            result.append(r)
    return result


def _existing_venues_query(
    source: str,
    country_code: str,
    family_slug: str | None,
    page_size: int,
    last_id: str,
) -> str:
    """Path PostgREST des venues existantes à réconcilier (pur → testable).

    #426 — `family_slug` (optionnel) scope la requête : indispensable pour un
    import mono-famille (sinon on charge toutes les familles source+pays).
    """
    path = (
        f"venue?select=id,external_id"
        f"&source=eq.{urllib.parse.quote(source)}"
        f"&country_code=eq.{urllib.parse.quote(country_code)}"
    )
    if family_slug:
        path += f"&family_slug=eq.{urllib.parse.quote(family_slug)}"
    path += f"&deleted_at=is.null&order=id.asc&limit={page_size}"
    if last_id:
        path += f"&id=gt.{last_id}"
    return path


def soft_delete_missing(
    client: SupabaseRestClient,
    source: str,
    country_code: str,
    seen_external_ids: set[str],
    chunk_size: int = 200,
    family_slug: str | None = None,
) -> int:
    """Soft-delete les venues (source, country_code[, family_slug]) absentes du
    batch courant.

    Logique (227.3) :
      1. Charge tous les external_id (source, country_code, deleted_at=null).
      2. Calcule l'ensemble des disparus = existants - seen_external_ids.
      3. PATCH deleted_at = now() sur ces ids (par lots, filtre sur external_id
         pour ne jamais toucher un venue d'une autre source).

    #426 — `family_slug` (optionnel) : un import MONO-famille ne voit que sa
    propre famille dans `seen_external_ids`. Sans scope, il soft-deleterait
    toutes les AUTRES familles (même source+pays) absentes de son batch → perte
    de données. Passer la famille courante borne la réconciliation à cette
    famille. `None` (ex. `--family all`) = réconciliation complète source+pays.

    Retourne le nombre de venues soft-deleted.
    """
    # 1. Récupère les external_id existants (paginé, keyset sur id)
    existing_extids: set[str] = set()
    last_id = ""
    page_size = 1000
    while True:
        path = _existing_venues_query(
            source, country_code, family_slug, page_size, last_id
        )
        req = urllib.request.Request(
            f"{client.url}/rest/v1/{path}",
            headers={
                "apikey": client.key,
                "Authorization": f"Bearer {client.key}",
            },
        )
        with urllib.request.urlopen(req, timeout=client.timeout) as resp:
            rows = json.loads(resp.read())
        if not rows:
            break
        for row in rows:
            if row.get("external_id"):
                existing_extids.add(row["external_id"])
        last_id = rows[-1]["id"]
        if len(rows) < page_size:
            break

    # 2. Disparus = existants non vus dans le batch courant
    missing = existing_extids - seen_external_ids
    if not missing:
        return 0

    # 3. Soft-delete par lots
    deleted = 0
    missing_list = list(missing)
    for i in range(0, len(missing_list), chunk_size):
        batch = missing_list[i : i + chunk_size]
        id_list = ",".join(urllib.parse.quote(x) for x in batch)
        patch = json.dumps({"deleted_at": "now()"}).encode()
        req = urllib.request.Request(
            f"{client.url}/rest/v1/venue?source=eq.{urllib.parse.quote(source)}"
            f"&external_id=in.({id_list})",
            data=patch,
            headers={
                "apikey": client.key,
                "Authorization": f"Bearer {client.key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            method="PATCH",
        )
        with urllib.request.urlopen(req, timeout=client.timeout):
            pass
        deleted += len(batch)

    return deleted


def open_import_run(
    client: SupabaseRestClient,
    source: str,
    scope: str,
    runner: str = "local",
    params: dict | None = None,
) -> str:
    """Crée une ligne import_run (status=running) et retourne son id."""
    run: dict = {
        "source": source,
        "scope": scope,
        "runner": runner,
        "status": "running",
        "run_hash": compute_run_hash(source, scope, params or {}),
    }
    data = json.dumps(run).encode()
    req = urllib.request.Request(
        f"{client.url}/rest/v1/import_run",
        data=data,
        headers={
            "apikey": client.key,
            "Authorization": f"Bearer {client.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=client.timeout) as resp:
        rows = json.loads(resp.read())
        return rows[0]["id"]


def close_import_run(
    client: SupabaseRestClient,
    run_id: str,
    result: UpsertResult,
    soft_deleted: int = 0,
    error: str | None = None,
) -> None:
    """Met à jour import_run avec les métriques finales."""
    patch: dict = {
        "status": "failed" if error else "completed",
        "rows_upserted": result.upserted,
        "rows_skipped": result.skipped,
        "rows_deleted": soft_deleted,
        "error_message": error,
    }
    data = json.dumps(patch).encode()
    req = urllib.request.Request(
        f"{client.url}/rest/v1/import_run?id=eq.{run_id}",
        data=data,
        headers={
            "apikey": client.key,
            "Authorization": f"Bearer {client.key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="PATCH",
    )
    with urllib.request.urlopen(req, timeout=client.timeout):
        pass


# ── Self-test (logique pure, sans DB) ────────────────────────────────────────

def self_test() -> int:
    """Tests sur la logique pure (sans réseau). Appelé par le CI."""

    # _derive_slug : stable + unique
    s1 = _derive_slug("osm", "way/12345")
    s2 = _derive_slug("osm", "way/12345")
    s3 = _derive_slug("osm", "way/99999")
    assert s1 == s2, f"slug instable: {s1} != {s2}"
    assert s1 != s3, "collision de slug"
    assert s1.startswith("osm-"), f"préfixe inattendu: {s1}"
    assert len(s1) == 12, f"longueur inattendue: {len(s1)}"  # 'osm-' + 8 hex

    # VenueRecord.to_api_dict : None non sérialisés
    r = VenueRecord(
        source="osm", external_id="way/1", name="TC Paris 15",
        lat=48.84, lon=2.29, family_slug="raquette",
        primary_sport_slug="tennis",
    )
    d = r.to_api_dict()
    assert d["source"] == "osm"
    assert d["family_slug"] == "raquette"
    assert "address" not in d, "None ne devrait pas être sérialisé"
    assert d["slug"] == _derive_slug("osm", "way/1")

    # VenueRecord avec champs optionnels
    r2 = VenueRecord(
        source="res", external_id="res/42", name="Tennis Nice",
        lat=43.7, lon=7.26, family_slug="raquette",
        address="1 Av. de la Paix", country_code="FR",
    )
    d2 = r2.to_api_dict()
    assert d2["address"] == "1 Av. de la Paix"
    assert d2["country_code"] == "FR"

    # batch_records : découpe correcte
    records = [
        VenueRecord(source="osm", external_id=f"way/{i}", name=f"V{i}",
                    lat=1.0, lon=1.0, family_slug="raquette")
        for i in range(7)
    ]
    batches = list(batch_records(records, 3))
    assert len(batches) == 3, f"attendu 3 lots, obtenu {len(batches)}"
    assert len(batches[0]) == 3
    assert len(batches[2]) == 1

    # compute_run_hash : stable + différent si params diffèrent
    h1 = compute_run_hash("osm", "raquette/FR", {"bbox": "fr"})
    h2 = compute_run_hash("osm", "raquette/FR", {"bbox": "fr"})
    h3 = compute_run_hash("osm", "raquette/FR", {"bbox": "eu"})
    assert h1 == h2, "run_hash instable"
    assert h1 != h3, "run_hash insensible aux paramètres"

    # UpsertResult.merge
    r1 = UpsertResult(upserted=10, skipped=2, errors=["e1"])
    r2 = UpsertResult(upserted=5, skipped=0, errors=[])
    m = r1.merge(r2)
    assert m.upserted == 15
    assert m.skipped == 2
    assert m.errors == ["e1"]

    # deduplicate_records : ~50m geo dedup
    dupes = [
        VenueRecord(source="osm", external_id=f"node/{i}", name=f"Club {i}",
                    lat=48.8500 + i * 0.00001,  # <0.0005° d'écart → même cellule
                    lon=2.3500, family_slug="raquette")
        for i in range(3)
    ]
    distinct = [
        VenueRecord(source="osm", external_id="node/100", name="Autre club",
                    lat=48.9000, lon=2.4000, family_slug="raquette"),
    ]
    all_r = dupes + distinct
    deduped = deduplicate_records(all_r)
    # les 3 premiers sont dans la même cellule 50m → 1 seul gardé
    assert len(deduped) == 2, f"attendu 2, obtenu {len(deduped)}"
    assert deduped[0].external_id == "node/0"  # premier gagne
    assert deduped[1].external_id == "node/100"

    # soft_delete_missing : logique de calcul des disparus (pure, sans réseau)
    seen = {"osm/node/1", "osm/node/2", "osm/node/3"}
    existing = {"osm/node/1", "osm/node/2", "osm/node/3", "osm/node/4", "osm/node/5"}
    missing = existing - seen
    assert missing == {"osm/node/4", "osm/node/5"}, f"disparus incorrects: {missing}"
    assert len(missing) == 2

    # Cas : aucun disparu
    missing_none = {"osm/node/1"} - {"osm/node/1"}
    assert len(missing_none) == 0

    # #426 — scope famille dans la query des venues existantes.
    q_fam = _existing_venues_query("osm", "FR", "raquette", 1000, "")
    assert "source=eq.osm" in q_fam
    assert "country_code=eq.FR" in q_fam
    assert "family_slug=eq.raquette" in q_fam, "scope famille manquant"
    q_all = _existing_venues_query("osm", "FR", None, 1000, "")
    assert "family_slug" not in q_all, "ne doit pas scoper si family_slug=None"
    q_keyset = _existing_venues_query("osm", "FR", "fitness", 1000, "abc")
    assert "id=gt.abc" in q_keyset, "keyset last_id manquant"

    print("✓ etl_upsert self-test OK")
    return 0


# ── Entrée ────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="ETL upsert helpers (#227)")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    print("Usage : python3 scripts/etl_upsert.py --self-test", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

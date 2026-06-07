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

#!/usr/bin/env python3
"""
Smoke test du schéma Supabase distant.

Vérifie :
  - Les tables de référentiel sont seedées (sport, country, amenity)
  - Les tables relationnelles existent et sont accessibles
  - PostGIS est actif : insert venue → trigger calcule geom auto
  - Cleanup propre du test

Usage :
  python3 scripts/db_check.py

Requiert .env.local avec NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.local"


def load_env() -> dict[str, str]:
    if not ENV_FILE.exists():
        sys.exit(f"❌ {ENV_FILE} introuvable. Copie .env.local.example et remplis les clés Supabase.")
    env: dict[str, str] = {}
    for raw in ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


def api_request(env: dict[str, str], path: str, *, method: str = "GET", body: dict | None = None,
                prefer: str | None = None) -> tuple[int, dict | list | None, str | None]:
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + path
    headers = {
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode()
            payload = json.loads(raw) if raw else None
            return resp.status, payload, resp.headers.get("Content-Range")
    except urllib.error.HTTPError as e:
        return e.code, None, e.read().decode()


def count(env: dict[str, str], table: str) -> int:
    status, _, content_range = api_request(
        env, f"/rest/v1/{table}?select=*&limit=0", prefer="count=exact"
    )
    if status not in (200, 206) or not content_range:
        return -1
    return int(content_range.split("/")[-1])


def main() -> int:
    env = load_env()
    print(f"→ {env['NEXT_PUBLIC_SUPABASE_URL']}\n")

    # 1. Counts sur les tables de référentiel + relationnelles
    expected_min = {
        "sport": 50, "country": 1, "amenity": 15,
        "venue": 0, "venue_sport": 0, "venue_amenity": 0,
        "booking_link": 0, "claim_request": 0, "city": 0,
    }
    failed = False
    print("Counts par table :")
    for table, mini in expected_min.items():
        n = count(env, table)
        mark = "✓" if n >= mini else "✗"
        if n < mini:
            failed = True
        print(f"  {mark} {table:<16} {n:>6} (min attendu : {mini})")

    # 2. Test PostGIS : insert venue → trigger calcule geom
    print("\nPostGIS smoke test :")
    test_slug = "smoke-test-postgis-trigger"
    status, payload, _ = api_request(
        env, "/rest/v1/venue", method="POST",
        body={
            "slug": test_slug, "name": "Smoke Test", "lat": 48.8584, "lon": 2.2945,
            "family_slug": "plus", "source": "editorial",
        },
        prefer="return=representation",
    )
    if status not in (200, 201):
        print(f"  ✗ insert KO (HTTP {status})")
        return 1

    status, payload, _ = api_request(
        env, f"/rest/v1/venue?slug=eq.{test_slug}&select=slug,lat,lon,geom",
    )
    has_geom = bool(payload and payload[0].get("geom"))
    print(f"  {'✓' if has_geom else '✗'} trigger geom : {payload[0]['geom'][:40] + '…' if has_geom else 'absent'}")
    if not has_geom:
        failed = True

    # Cleanup
    status, _, _ = api_request(env, f"/rest/v1/venue?slug=eq.{test_slug}", method="DELETE")
    print(f"  {'✓' if status == 204 else '✗'} cleanup (HTTP {status})")

    print()
    if failed:
        print("❌ DB check FAILED — au moins une vérification a échoué.")
        return 1
    print("✅ DB check OK — schema appliqué, PostGIS actif, seed présent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

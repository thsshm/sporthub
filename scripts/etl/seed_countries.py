#!/usr/bin/env python3
"""
seed_countries.py — Complète la table `country` avec tous les pays ISO 3166-1.

Contexte : la table `country` est incomplète (ex. IS, AM manquants) → les imports
de venues dans ces pays échouent sur la FK `venue_country_code` et sont perdus.
On seed l'intégralité de l'ISO 3166-1 alpha-2 en mode ignore-duplicates : les
pays existants ne sont PAS modifiés, seuls les manquants sont ajoutés.

Source : lib `pycountry` (codes + noms EN fiables ; FR via gettext, fallback EN).
emoji_flag dérivé du code (indicateurs régionaux Unicode).

Auth : SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env/CI). Dry-run par défaut.

Exemples :
  pip install pycountry
  python3 scripts/etl/seed_countries.py --dry-run
  python3 scripts/etl/seed_countries.py --apply
"""
from __future__ import annotations

import argparse
import gettext
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _load_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    env_file = _REPO_ROOT / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    url = (env.get("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
           or os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""))
    key = (env.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    if not url or not key:
        print("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants", file=sys.stderr)
        raise SystemExit(1)
    return url.rstrip("/"), key


def _flag(code: str) -> str:
    """Emoji drapeau depuis le code alpha-2 (indicateurs régionaux)."""
    try:
        return "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in code.upper())
    except Exception:  # noqa: BLE001
        return ""


def build_rows() -> list[dict]:
    import pycountry  # import tardif : dépendance optionnelle (CI : pip install)

    try:
        fr = gettext.translation("iso3166-1", pycountry.LOCALES_DIR, languages=["fr"])
        fr_name = fr.gettext
    except Exception:  # noqa: BLE001
        fr_name = lambda s: s  # noqa: E731  (fallback : pas de traduction FR)

    rows: list[dict] = []
    for c in pycountry.countries:
        code = getattr(c, "alpha_2", None)
        if not code:
            continue
        name_en = getattr(c, "common_name", None) or c.name
        name_fr = fr_name(c.name)
        rows.append({
            "code": code,
            "name_en": name_en,
            "name_fr": name_fr if name_fr and name_fr != c.name else name_en,
            "emoji_flag": _flag(code),
        })
    return rows


def upsert_ignore(url: str, key: str, rows: list[dict]) -> int:
    """INSERT en ignorant les conflits (PK code) → n'écrase aucun pays existant."""
    body = json.dumps(rows).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/country",
        data=body,
        headers={
            "apikey": key, "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=representation",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            inserted = json.loads(resp.read() or b"[]")
        return len(inserted)
    except urllib.error.HTTPError as e:
        print(f"❌ HTTP {e.code}: {e.read()[:300].decode('utf-8', 'replace')}",
              file=sys.stderr)
        raise


def main() -> int:
    p = argparse.ArgumentParser(description="Seed table country (ISO 3166-1).")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="écrit réellement")
    mode.add_argument("--dry-run", action="store_true", help="défaut : aucune écriture")
    args = p.parse_args()

    rows = build_rows()
    print(f"▶ {len(rows)} pays ISO 3166-1 construits (ex. "
          f"{rows[0]['code']}={rows[0]['name_fr']} {rows[0]['emoji_flag']})")

    if not args.apply:
        sample = ", ".join(f"{r['code']}" for r in rows[:20])
        print(f"  ✓ [DRY-RUN] {len(rows)} pays seraient upsertés (ignore-duplicates). "
              f"Échantillon: {sample}… Relance avec --apply.")
        return 0

    url, key = _load_env()
    inserted = upsert_ignore(url, key, rows)
    print(f"  ✓ {inserted} pays AJOUTÉS (manquants) ; {len(rows) - inserted} déjà présents (inchangés).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

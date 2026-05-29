/**
 * Cron Hyrox refresh — re-import des Hyrox Training Clubs dans `venue`.
 *
 * Source : endpoint admin-ajax Store Locator Plus de gyms.elbnetz.cloud
 * (iframe de hyrox.com → "Find a HYROX TRAINING CLUB"). Tout est récupéré en
 * un appel via `autoload=1` (~12 700 entrées mondiales).
 *
 * Source URL et logique métier copiées de
 *   ~/Documents/Claude/Projects/SportHub/data-pipeline/scripts/scrape_hyrox.py
 * (V1) — voir ADR-009 du DASHBOARD V1 pour le contexte.
 *
 * Schedule (Vercel cron, cf. `vercel.json`) : tous les lundis à 03:00 UTC.
 * Idempotence : upsert par `venue.slug` (= `slugify(name)-hyrox-<id>`), jamais
 * de DELETE — un Hyrox disparu de la source reste dans la DB tel quel.
 *
 * Issue : https://github.com/thsshm/sporthub/issues/109
 */
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { verifyCronAuth } from "@/lib/cron/auth";
import { logCronCompleted } from "@/lib/cron/log";
import { venueSlugFromName } from "@/lib/cron/slug";
import type { Json } from "@/lib/supabase/types";

// Node runtime (pas Edge) — on a besoin de `fetch` standard + accès Supabase
// admin via @supabase/ssr (qui dépend de next/headers, non disponible côté Edge
// d'une route handler sans setup spécifique).
export const runtime = "nodejs";
// Désactive tout caching de la route — un cron doit toujours s'exécuter en frais.
export const dynamic = "force-dynamic";
// Vercel Hobby : timeout 60s par défaut. ~12 700 venues × 1 PATCH chacun → on
// reste large pour ne pas casser sur Hobby. Sur Pro, on peut monter à 300.
export const maxDuration = 60;

const HYROX_ENDPOINT =
  "https://gyms.elbnetz.cloud/wp-admin/admin-ajax.php?action=store_search&autoload=1";
const USER_AGENT =
  "SportHubMap/1.0 (+https://sporthubmap.com; admin@sporthubmap.com)";

const EVENT_NAME = "cron.refresh-hyrox.completed";

/**
 * Forme brute renvoyée par l'endpoint Store Locator Plus.
 * On ne type QUE les champs qu'on consomme — le reste est ignoré.
 */
type HyroxRaw = {
  id?: string | number;
  store?: string;
  lat?: string | number;
  lng?: string | number;
  url?: string;
  city?: string;
  country?: string;
  zip?: string;
  address?: string;
  address2?: string;
};

/** Forme finale d'un venue prêt à être upserté en DB. */
type HyroxVenueRow = {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  address: string | null;
  postal_code: string | null;
  country_code: string | null;
  website_url: string | null;
  family_slug: string;
  primary_sport_slug: string;
  is_indoor: boolean;
  source: string;
  external_id: string;
  enrichments: Json;
};

function normalizeWebsite(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  // Sentinelles V1 — on a vu "Non" / "non" passer dans l'API source.
  const stripped = withScheme.replace(/\/$/, "").toLowerCase();
  if (stripped === "http://non" || stripped === "https://non") return null;
  return withScheme;
}

function toCountryCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  // venue.country_code → ISO 3166-1 alpha-2 (cf. schéma 0001).
  return trimmed.length === 2 ? trimmed : null;
}

function buildAddress(raw: HyroxRaw): string | null {
  const parts = [raw.address, raw.address2]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Mappe une fiche brute Hyrox vers un row `venue`.
 * Retourne `null` pour les lignes invalides (lat/lon hors range, name vide,
 * (0,0) bugué côté source — cas connu V1).
 */
function rawToVenue(raw: HyroxRaw): HyroxVenueRow | null {
  const lat = typeof raw.lat === "number" ? raw.lat : parseFloat(String(raw.lat));
  const lon = typeof raw.lng === "number" ? raw.lng : parseFloat(String(raw.lng));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (lat === 0 && lon === 0) return null; // 4 fiches buguées V1.

  const name = (raw.store ?? "").trim();
  if (!name) return null;

  const recId = raw.id !== undefined && raw.id !== null ? String(raw.id) : null;
  if (!recId) return null;

  const externalId = `hyrox/${recId}`;
  return {
    slug: venueSlugFromName(name, externalId),
    name,
    lat,
    lon,
    address: buildAddress(raw),
    postal_code: (raw.zip ?? "").trim() || null,
    country_code: toCountryCode(raw.country),
    website_url: normalizeWebsite(raw.url),
    family_slug: "fitness",
    primary_sport_slug: "hyrox",
    is_indoor: true,
    source: "hyrox",
    external_id: externalId,
    enrichments: {
      hyrox_partner: true,
      hyrox_id: recId,
    },
  };
}

async function fetchHyroxList(): Promise<HyroxRaw[]> {
  const res = await fetch(HYROX_ENDPOINT, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    // Pas de cache : on veut TOUJOURS la dernière liste à chaque cron.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Hyrox source returned HTTP ${res.status}`);
  }
  const json: unknown = await res.json();
  if (!Array.isArray(json)) {
    throw new Error("Hyrox source did not return a JSON array");
  }
  return json as HyroxRaw[];
}

export async function GET(request: Request) {
  const authFailure = verifyCronAuth(request);
  if (authFailure) return authFailure.response;

  const startedAt = Date.now();
  let upserted = 0;
  let failed = 0;
  let totalFetched = 0;

  try {
    const raws = await fetchHyroxList();
    totalFetched = raws.length;

    const rows: HyroxVenueRow[] = [];
    for (const raw of raws) {
      const venue = rawToVenue(raw);
      if (venue) rows.push(venue);
    }

    const sb = getSupabaseAdminClient();

    // Upsert par batch pour ne pas saturer PostgREST sur ~12 700 rows.
    // `on_conflict=slug` : slug est UNIQUE en DB (cf. 0001_initial_schema.sql),
    // donc on UPDATE le row existant si présent. Aucun DELETE.
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { error } = await sb
        .from("venue")
        .upsert(chunk, { onConflict: "slug", ignoreDuplicates: false });
      if (error) {
        failed += chunk.length;
        captureException(error, {
          route: "/api/cron/refresh-hyrox",
          batchStart: i,
          batchSize: chunk.length,
        });
      } else {
        upserted += chunk.length;
      }
    }
  } catch (err) {
    captureException(err, { route: "/api/cron/refresh-hyrox" });
    const duration_ms = Date.now() - startedAt;
    logCronCompleted({
      event: EVENT_NAME,
      upserted,
      failed,
      duration_ms,
      extra: { error: err instanceof Error ? err.message : "unknown" },
    });
    return NextResponse.json(
      { ok: false, upserted, failed, duration_ms },
      { status: 500 },
    );
  }

  const duration_ms = Date.now() - startedAt;
  logCronCompleted({
    event: EVENT_NAME,
    upserted,
    failed,
    duration_ms,
    extra: { fetched: totalFetched },
  });
  return NextResponse.json({
    ok: true,
    upserted,
    failed,
    duration_ms,
    fetched: totalFetched,
  });
}

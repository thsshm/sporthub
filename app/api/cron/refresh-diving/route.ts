/**
 * Cron Diving refresh — re-import des centres de plongée depuis OSM Overpass.
 *
 * Source : OpenStreetMap via l'Overpass API (ODbL).
 * Cible :
 *   - `amenity=dive_centre` (centres certifiés/affiliés PADI, SSI, CMAS…)
 *   - `shop=scuba_diving`
 *   - `sport=scuba_diving`
 *
 * Pourquoi pas l'API PADI ? PADI/SSI = API payantes. OSM est le seul jeu de
 * données global, libre et bien renseigné. Quand un centre est affilié
 * PADI/SSI, le tag `brand=PADI` ou `operator=PADI` est souvent présent — on
 * les capte aussi dans `enrichments`.
 *
 * Source URL et logique métier copiées de
 *   ~/Documents/Claude/Projects/SportHub/scripts/diving/build.py
 * (V1) — BRIEF.md V1.
 *
 * Schedule (Vercel cron, cf. `vercel.json`) : tous les lundis à 05:00 UTC.
 * Idempotence : upsert par `venue.slug` (= `slugify(name)-osm-<type>-<id>`),
 * jamais de DELETE.
 *
 * Issue : https://github.com/thsshm/sporthub/issues/109
 */
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { verifyCronAuth } from "@/lib/cron/auth";
import { logCronCompleted } from "@/lib/cron/log";
import { venueSlugFromName } from "@/lib/cron/slug";
import { softUnpublishMissing } from "@/lib/cron/soft-unpublish";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OVERPASS = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "SportHubMap/1.0 (gautier.no@gmail.com) - https://sporthubmap.com";

// Trois requêtes séparées (Overpass sature quand on combine, cf. V1).
// On dédup côté code par (type,id) avant l'upsert.
const QUERIES: readonly string[] = [
  '[out:json][timeout:40];(node["amenity"="dive_centre"];way["amenity"="dive_centre"];);out center tags;',
  '[out:json][timeout:40];(node["shop"="scuba_diving"];way["shop"="scuba_diving"];);out center tags;',
  '[out:json][timeout:40];(node["sport"="scuba_diving"];way["sport"="scuba_diving"];);out center tags;',
];

const EVENT_NAME = "cron.refresh-diving.completed";

type OverpassElement = {
  type?: "node" | "way" | "relation";
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

type DivingVenueRow = {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  address: string | null;
  postal_code: string | null;
  country_code: string | null;
  website_url: string | null;
  phone: string | null;
  family_slug: string;
  primary_sport_slug: string;
  is_indoor: boolean | null;
  source: string;
  external_id: string;
  last_seen_at: string;
  enrichments: Json;
};

async function fetchOverpass(query: string): Promise<OverpassElement[]> {
  const body = new URLSearchParams({ data: query });
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}`);
  }
  const json = (await res.json()) as { elements?: OverpassElement[] };
  return json.elements ?? [];
}

function elementToVenue(el: OverpassElement): DivingVenueRow | null {
  const tags = el.tags ?? {};
  let name = (tags["name"] ?? tags["operator"] ?? tags["brand"] ?? "").trim();
  if (!name) {
    // V1 gardait les dive_centre sans nom (informatifs). On fait pareil.
    if (tags["amenity"] === "dive_centre") name = "Dive centre";
    else return null;
  }

  let lat: number | undefined;
  let lon: number | undefined;
  if (el.type === "node") {
    lat = el.lat;
    lon = el.lon;
  } else {
    lat = el.center?.lat;
    lon = el.center?.lon;
  }
  if (lat === undefined || lon === undefined) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  if (el.type === undefined || el.id === undefined) return null;

  const brand = (tags["brand"] ?? tags["operator"] ?? "").toUpperCase();
  const features: Record<string, true> = { dive_centre: true };
  if (brand.includes("PADI")) features.padi_affiliated = true;
  if (brand.includes("SSI")) features.ssi_affiliated = true;
  if (brand.includes("CMAS")) features.cmas_affiliated = true;
  if (tags["shop"] === "scuba_diving") features.shop = true;
  if (tags["sport"] === "scuba_diving") features.dive_site = true;

  const externalId = `osm/${el.type}/${el.id}`;
  const addressParts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:city"],
    tags["addr:postcode"],
  ]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  const address = addressParts.length > 0 ? addressParts.join(", ") : null;

  const country = (tags["addr:country"] ?? "").trim().toUpperCase();

  return {
    slug: venueSlugFromName(name, externalId),
    name,
    lat,
    lon,
    address,
    postal_code: (tags["addr:postcode"] ?? "").trim() || null,
    country_code: country.length === 2 ? country : null,
    website_url:
      (tags["website"] ?? tags["contact:website"] ?? "").trim() || null,
    phone: (tags["phone"] ?? tags["contact:phone"] ?? "").trim() || null,
    family_slug: "nautique",
    primary_sport_slug: "diving",
    is_indoor: null,
    source: "osm-diving",
    external_id: externalId,
    last_seen_at: new Date().toISOString(),
    enrichments: {
      diving_features: features,
      raw_tags: tags,
    },
  };
}

export async function GET(request: Request) {
  const authFailure = verifyCronAuth(request);
  if (authFailure) return authFailure.response;

  const runStart = new Date();
  const startedAt = Date.now();
  let upserted = 0;
  let failed = 0;
  let totalElements = 0;

  try {
    // Lance les 3 requêtes Overpass en parallèle — Overpass tolère bien
    // 3 connexions concurrentes pour un même client.
    const results = await Promise.allSettled(QUERIES.map(fetchOverpass));
    const seenByExternalId = new Map<string, DivingVenueRow>();

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        failed++;
        captureException(r.reason, {
          route: "/api/cron/refresh-diving",
          queryIndex: i,
        });
        continue;
      }
      totalElements += r.value.length;
      for (const el of r.value) {
        const v = elementToVenue(el);
        if (!v) continue;
        // Dédup multi-requêtes (un node peut matcher amenity= + sport=).
        if (!seenByExternalId.has(v.external_id)) {
          seenByExternalId.set(v.external_id, v);
        }
      }
    }

    const allRows = Array.from(seenByExternalId.values());
    const sb = getSupabaseAdminClient();
    const BATCH = 200;
    for (let i = 0; i < allRows.length; i += BATCH) {
      const chunk = allRows.slice(i, i + BATCH);
      const { error } = await sb
        .from("venue")
        .upsert(chunk as never, { onConflict: "slug", ignoreDuplicates: false }); // eslint-disable-line @typescript-eslint/no-explicit-any -- types Supabase régénérés trop stricts vs enrichments Record<string,unknown>
      if (error) {
        failed += chunk.length;
        captureException(error, {
          route: "/api/cron/refresh-diving",
          batchStart: i,
          batchSize: chunk.length,
        });
      } else {
        upserted += chunk.length;
      }
    }
  } catch (err) {
    captureException(err, { route: "/api/cron/refresh-diving" });
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

  // Soft-unpublish des venues disparues de la source (#399).
  // Garde-plancher : ne désactive rien si le run a ramené < 90 % du connu
  // (détecte les fetches partiels dus aux 429 Overpass).
  const sb2 = getSupabaseAdminClient();
  const softResult = await softUnpublishMissing(sb2, "osm-diving", runStart, upserted);

  const duration_ms = Date.now() - startedAt;
  logCronCompleted({
    event: EVENT_NAME,
    upserted,
    failed,
    duration_ms,
    extra: { totalElements, softUnpublish: softResult },
  });
  return NextResponse.json({
    ok: true,
    upserted,
    failed,
    duration_ms,
    totalElements,
    softUnpublish: softResult,
  });
}

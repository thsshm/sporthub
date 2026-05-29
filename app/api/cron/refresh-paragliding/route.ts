/**
 * Cron Paragliding refresh — re-import des sites parapente / deltaplane.
 *
 * Source : API publique de paraglidingearth.com (CC-BY-SA / ODbL).
 * Endpoint : /api/geojson/getCountrySites.php?iso=<code>
 * Documentation : https://paraglidingearth.com/api/
 *
 * Source URL et logique métier copiées de
 *   ~/Documents/Claude/Projects/SportHub/scripts/paragliding/build.py
 * (V1) — voir BRIEF.md V1.
 *
 * Schedule (Vercel cron, cf. `vercel.json`) : tous les lundis à 04:00 UTC.
 * Idempotence : upsert par `venue.slug` (= `slugify(name)-pge-<id>`),
 * jamais de DELETE.
 *
 * Le scraping liste les pays un à un — V1 itère sur ~210 ISO codes en parallèle
 * (12 threads). En Vercel, on utilise `Promise.all` avec un parallélisme borné
 * pour rester sous 60s sur le plan Hobby. Si on touche le `maxDuration`, on
 * loggue et on coupe — le prochain run reprendra.
 *
 * Issue : https://github.com/thsshm/sporthub/issues/109
 */
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { verifyCronAuth } from "@/lib/cron/auth";
import { logCronCompleted } from "@/lib/cron/log";
import { venueSlugFromName } from "@/lib/cron/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Plan Hobby = 60s max. On vise ≤55s d'execution effective avec early-exit.
export const maxDuration = 60;

const ENDPOINT_TPL =
  "https://www.paraglidingearth.com/api/geojson/getCountrySites.php?iso={iso}&style=detailled";
const USER_AGENT =
  "SportHubMap/1.0 (+https://sporthubmap.com) - CC-BY-SA attribution: paraglidingearth.com";
const EVENT_NAME = "cron.refresh-paragliding.completed";

// ~210 codes ISO 3166-1 alpha-2, identique à V1 (cf. scripts/paragliding/build.py).
// Couvre l'Europe, Amériques, Asie, Afrique, Océanie sans pays sans relief.
const COUNTRY_CODES: readonly string[] = [
  // Europe
  "ad","al","at","ba","be","bg","by","ch","cy","cz","de","dk","ee","es","fi","fr","gb",
  "ge","gr","hr","hu","ie","is","it","li","lt","lu","lv","mc","md","me","mk","mt","nl",
  "no","pl","pt","ro","rs","ru","se","si","sk","sm","tr","ua","va","xk",
  // Amériques
  "ag","ar","bb","bo","br","bs","bz","ca","cl","co","cr","cu","do","ec","gd","gt","gy",
  "hn","ht","jm","kn","lc","mx","ni","pa","pe","pr","py","sr","sv","tt","us","uy","vc","ve",
  // Asie
  "ae","af","am","az","bd","bh","bn","bt","cn","hk","id","il","in","iq","ir","jo","jp",
  "kg","kh","kp","kr","kw","kz","la","lb","lk","mm","mn","mo","mv","my","np","om","pk",
  "ph","ps","qa","sa","sg","sy","th","tj","tm","tw","uz","vn","ye",
  // Afrique
  "ao","bf","bi","bj","bw","cd","cf","cg","ci","cm","cv","dj","dz","eg","er","et","ga",
  "gh","gm","gn","gq","gw","ke","km","lr","ls","ly","ma","mg","ml","mr","mu","mw","mz",
  "na","ne","ng","rw","sc","sd","sl","sn","so","ss","st","sz","td","tg","tn","tz","ug",
  "za","zm","zw",
  // Océanie
  "as","au","ck","fj","fm","gu","ki","mh","mp","nc","nf","nr","nu","nz","pf","pg","pn",
  "pw","sb","tk","to","tv","vu","wf","ws",
];

const PARALLELISM = 8; // PGE tient sans rate-limit, mais on reste poli.
// Budget de temps pour la phase fetch — laisse ~10s pour les upserts batch.
const FETCH_TIME_BUDGET_MS = 45_000;

type PgeFeature = {
  type?: string;
  id?: string | number;
  geometry?: {
    type?: string;
    coordinates?: number[];
  };
  properties?: Record<string, unknown>;
};

type PgeResponse = {
  features?: PgeFeature[];
};

type ParaglidingVenueRow = {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  country_code: string | null;
  website_url: string | null;
  family_slug: string;
  primary_sport_slug: string;
  is_indoor: boolean;
  description: string | null;
  source: string;
  external_id: string;
  enrichments: Record<string, unknown>;
};

function asBool01(v: unknown): boolean {
  return v === 1 || v === "1" || v === true;
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function featureToVenue(feat: PgeFeature): ParaglidingVenueRow | null {
  const geom = feat.geometry;
  if (!geom || geom.type !== "Point") return null;
  const coords = geom.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const props = feat.properties ?? {};
  const name = asString(props["name"]);
  if (!name) return null;

  const siteId = String(props["pge_site_id"] ?? feat.id ?? "").trim();
  if (!siteId) return null;

  const country = asString(props["countryCode"]);
  const features: Record<string, true> = { paragliding_takeoff: true };
  if (asBool01(props["hanggliding"])) features.hanggliding = true;
  if (asBool01(props["thermals"])) features.thermals = true;
  if (asBool01(props["soaring"])) features.soaring = true;
  if (asBool01(props["xc"])) features.xc = true;
  if (asBool01(props["winch"])) features.winch = true;

  let altitudeM: number | null = null;
  const altRaw = props["takeoff_altitude"];
  if (altRaw !== null && altRaw !== undefined && altRaw !== "" && altRaw !== "0") {
    const n = Number(altRaw);
    if (Number.isFinite(n)) altitudeM = Math.trunc(n);
  }

  const desc = asString(props["takeoff_description"]);
  const externalId = `pge/${siteId}`;
  return {
    slug: venueSlugFromName(name, externalId),
    name,
    lat,
    lon,
    country_code:
      country && country.length === 2 ? country.toUpperCase() : null,
    website_url: asString(props["pge_link"]),
    family_slug: "plus",
    primary_sport_slug: "paragliding",
    is_indoor: false,
    description: desc ? desc.slice(0, 300) : null,
    source: "paraglidingearth",
    external_id: externalId,
    enrichments: {
      paragliding_features: features,
      ...(altitudeM !== null ? { altitude_m: altitudeM } : {}),
      pge_site_id: siteId,
    },
  };
}

async function fetchCountry(iso: string): Promise<PgeFeature[]> {
  const url = ENDPOINT_TPL.replace("{iso}", iso);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`PGE ${iso} → HTTP ${res.status}`);
  }
  const json = (await res.json()) as PgeResponse;
  return Array.isArray(json.features) ? json.features : [];
}

/**
 * Lance les fetch par "vague" de taille `PARALLELISM` et coupe la boucle
 * si on dépasse `FETCH_TIME_BUDGET_MS` — ainsi on rentre toujours dans
 * `maxDuration` sur Hobby. Le prochain cron reprendra (les codes restants
 * seront traités tant qu'ils existent dans la source).
 *
 * Pour rester déterministe, on shuffle l'ordre par run en faisant tourner
 * un offset basé sur la semaine : ainsi chaque pays est touché ~1x/semaine
 * même si on coupe avant la fin sur une exécution donnée.
 */
function rotatedCountries(): readonly string[] {
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const offset = week % COUNTRY_CODES.length;
  return [...COUNTRY_CODES.slice(offset), ...COUNTRY_CODES.slice(0, offset)];
}

export async function GET(request: Request) {
  const authFailure = verifyCronAuth(request);
  if (authFailure) return authFailure.response;

  const startedAt = Date.now();
  let upserted = 0;
  let failed = 0;
  let countriesProcessed = 0;
  let countriesSkipped = 0;

  try {
    const orderedCountries = rotatedCountries();
    const seenSlugs = new Set<string>();
    const allRows: ParaglidingVenueRow[] = [];

    for (let i = 0; i < orderedCountries.length; i += PARALLELISM) {
      if (Date.now() - startedAt > FETCH_TIME_BUDGET_MS) {
        countriesSkipped = orderedCountries.length - i;
        break;
      }
      const batch = orderedCountries.slice(i, i + PARALLELISM);
      const results = await Promise.allSettled(batch.map(fetchCountry));
      for (let k = 0; k < results.length; k++) {
        const r = results[k];
        countriesProcessed++;
        if (r.status === "rejected") {
          failed++;
          captureException(r.reason, {
            route: "/api/cron/refresh-paragliding",
            country: batch[k],
          });
          continue;
        }
        for (const feat of r.value) {
          const v = featureToVenue(feat);
          if (!v) continue;
          // Dédup intra-batch : un site peut être listé dans 2 pays
          // (frontière) côté PGE — on ne garde que la première occurrence.
          if (seenSlugs.has(v.slug)) continue;
          seenSlugs.add(v.slug);
          allRows.push(v);
        }
      }
    }

    const sb = getSupabaseAdminClient();
    const BATCH = 200;
    for (let i = 0; i < allRows.length; i += BATCH) {
      const chunk = allRows.slice(i, i + BATCH);
      const { error } = await sb
        .from("venue")
        .upsert(chunk, { onConflict: "slug", ignoreDuplicates: false });
      if (error) {
        failed += chunk.length;
        captureException(error, {
          route: "/api/cron/refresh-paragliding",
          batchStart: i,
          batchSize: chunk.length,
        });
      } else {
        upserted += chunk.length;
      }
    }
  } catch (err) {
    captureException(err, { route: "/api/cron/refresh-paragliding" });
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
    extra: { countriesProcessed, countriesSkipped },
  });
  return NextResponse.json({
    ok: true,
    upserted,
    failed,
    duration_ms,
    countriesProcessed,
    countriesSkipped,
  });
}

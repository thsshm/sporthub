/**
 * Helpers de fetching des entries pour les sitemap shards.
 *
 * Cette couche TOUCHE Supabase et next-intl (routing). Les sérialiseurs XML
 * purs sont dans `sitemap-render.ts` (pour les tests sans DB).
 *
 * Structure des routes (cf. VENUE_SHARD_COUNT) :
 *   - /sitemap.xml              → sitemap-index (liste TOTAL_SHARD_COUNT sous-sitemaps)
 *   - /sitemap/0.xml            → statiques + familles + disciplines + program.
 *   - /sitemap/1.xml … /12.xml  → venues paginés (45 000 chacun = 540k max)
 *   - /sitemap/13.xml           → clubs (/club/[slug])
 */

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FAMILIES } from "@/lib/families";
import { routing } from "@/i18n/routing";
import { shardIdRange, type SitemapEntry } from "@/lib/seo/sitemap-render";
import { isLowQualityVenue, type ScorableVenue } from "@/lib/venue/quality-score";

export const SITE_URL = "https://sporthubmap.com";

/**
 * Cap par shard. 45k respecte les DEUX limites Google par sitemap :
 *   1. limite « nombre d'URLs »  : 50 000 max  → 45k OK (marge 10 %)
 *   2. limite « poids »          : 50 MB max   → voir audit ci-dessous
 *
 * Audit poids (#108 part 2/2, hreflang × 3 locales fr/en/zh comptés) :
 *   chaque <url> = <loc> + lastmod + changefreq + priority + 3 <xhtml:link>.
 *   Poids mesuré par <url> (cf. MIGRATION.md § « i18n routes /en /zh ») :
 *     - slug court  (~20 car.) : ~523 B  → 45k = 22,4 MB / shard
 *     - slug moyen  (~44 car.) : ~619 B  → 45k = 26,6 MB / shard
 *     - slug long   (~75 car.) : ~743 B  → 45k = 31,9 MB / shard
 *   Pire cas 31,9 MB < 50 MB : marge confortable. La limite « 50 000 URLs »
 *   est atteinte AVANT la limite poids (~70k URLs au pire cas), donc 45k
 *   reste le facteur contraignant — pas besoin de réduire le cap.
 */
export const URLS_PER_SHARD = 45_000;

/**
 * Nombre de shards venues. Capacité indexable = VENUE_SHARD_COUNT × URLS_PER_SHARD.
 *
 * ⚠️ 8 (= 360k) était INSUFFISANT : à 371k venues publiées (mesuré 2026-06-07),
 * chaque tranche UUID faisait ~46,5k > cap 45k → ~11k venues tronquées
 * silencieusement (`.slice(0, URLS_PER_SHARD)`), absentes du sitemap (jamais
 * soumises à Google). Cf. #402.
 *
 * Passé à 12 → ~31k/shard aujourd'hui, capacité 540k (marge pour la croissance ;
 * chaque shard reste < limite Google de 50k URLs/sitemap). `id` = UUID v4
 * (aléatoire) → distribution par tranche uniforme. Le test garde-fou
 * (sitemap-shards.test.ts) bloque si la capacité repasse sous le seuil.
 */
export const VENUE_SHARD_COUNT = 12;

/**
 * Shard dédié aux pages club (/club/[slug], #398). Isolé dans son propre shard
 * (pas dans le shard 0 metadata) car les clubs croissent avec le clustering
 * (#311) → aucune interaction avec le cap 45k du shard metadata. Index = juste
 * après les shards venues.
 */
export const CLUB_SHARD_INDEX = VENUE_SHARD_COUNT + 1;

/** Total = 1 metadata + VENUE_SHARD_COUNT venues + 1 clubs sous-sitemaps. */
export const TOTAL_SHARD_COUNT = VENUE_SHARD_COUNT + 2;

/**
 * Sports servis par /disciplines/[sport]. COUPLAGE : doit rester aligné avec
 * `RANKED_SPORTS` de `app/[locale]/disciplines/[sport]/page.tsx` (et la MV
 * `mv_top_clubs_by_sport`). Si la liste évolue côté app, mettre à jour ici.
 */
const DISCIPLINE_SPORTS = ["tennis", "padel", "table_tennis", "badminton", "squash"] as const;

type VenueRow = {
  id: string;
  slug: string;
  updated_at: string | null;
  // Champs du score qualité (#464/#465) : permettent d'exclure du sitemap les
  // fiches déjà passées en `noindex` par buildVenueMetadata (#490). Sans ça, le
  // sitemap listait des URLs noindexées → signal contradictoire + crawl budget
  // gâché sur ~371k fiches dont beaucoup de squelettes OSM/Overture.
  address: string | null;
  city_id: string | null;
  website_url: string | null;
  phone: string | null;
  description: string | null;
  primary_sport_slug: string | null;
  claim_status: ScorableVenue["claim_status"];
  enrichments: ScorableVenue["enrichments"];
};
type ComboRow = {
  primary_sport_slug: string | null;
  country_code: string | null;
  city: { slug?: string } | null;
};

/**
 * Construit une entry multi-locale avec hreflang via alternates.
 * - FR (default) = URL sans préfixe (préserve les URLs V1)
 * - EN = /en/path
 * - ZH = /zh/path
 */
function localized(
  path: string,
  meta: Omit<SitemapEntry, "loc" | "alternates"> = {}
): SitemapEntry {
  const alternates = Object.fromEntries(
    routing.locales.map((l) => [
      l,
      `${SITE_URL}${l === routing.defaultLocale ? path : `/${l}${path}`}`,
    ])
  );
  return {
    loc: alternates[routing.defaultLocale],
    alternates,
    ...meta,
  };
}

/** Shard 0 : pages statiques + familles + programmatiques (dédupliqués). */
export async function buildMetadataShard(): Promise<SitemapEntry[]> {
  const sb = getSupabaseServerClient();
  const now = new Date().toISOString();

  const staticEntries: SitemapEntry[] = [
    localized("/", { lastmod: now, changefreq: "daily", priority: 1.0 }),
    localized("/map", { lastmod: now, changefreq: "daily", priority: 0.9 }),
  ];

  const familyEntries: SitemapEntry[] = FAMILIES.map((f) =>
    localized(`/sports/${f.sports[0]}`, {
      lastmod: now,
      changefreq: "monthly",
      priority: 0.7,
    })
  );

  // Pages /disciplines/[sport] — classement national des clubs (#366/#398).
  const disciplineEntries: SitemapEntry[] = DISCIPLINE_SPORTS.map((s) =>
    localized(`/disciplines/${s}`, {
      lastmod: now,
      changefreq: "weekly",
      priority: 0.8,
    })
  );

  // Paginé pour contourner le cap PostgREST 1000 rows. On scanne jusqu'à
  // URLS_PER_SHARD rows sources, ce qui après dédup (sport × pays × ville)
  // donne un nombre de combos bien inférieur. Cf. PAGE_SIZE plus bas.
  const PAGE_SIZE_LOCAL = 1000;
  const allCombos: ComboRow[] = [];
  for (let from = 0; from < URLS_PER_SHARD; from += PAGE_SIZE_LOCAL) {
    const to = Math.min(from + PAGE_SIZE_LOCAL - 1, URLS_PER_SHARD - 1);
    const { data, error } = await sb
      .from("venue")
      .select("primary_sport_slug, country_code, city:city_id ( slug )")
      .eq("is_published", true)
      .is("deleted_at", null)
      .not("city_id", "is", null)
      .not("country_code", "is", null)
      .not("primary_sport_slug", "is", null)
      .order("id")
      .range(from, to);
    if (error || !data) break;
    allCombos.push(...(data as ComboRow[]));
    if (data.length < to - from + 1) break;
  }

  const seen = new Set<string>();
  const programmaticEntries: SitemapEntry[] = [];
  for (const row of allCombos) {
    if (!row.primary_sport_slug || !row.country_code || !row.city?.slug) {
      continue;
    }
    const key = `${row.primary_sport_slug}/${row.country_code.toLowerCase()}/${row.city.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    programmaticEntries.push(
      localized(`/${key}`, {
        lastmod: now,
        changefreq: "weekly",
        priority: 0.9,
      })
    );
  }

  return [...staticEntries, ...familyEntries, ...disciplineEntries, ...programmaticEntries];
}

/**
 * Cap PostgREST par requête sur Supabase (max-rows = 1000 par défaut).
 * Pour récupérer URLS_PER_SHARD (45 000), on doit paginer en interne.
 */
const PAGE_SIZE = 1000;

/**
 * Shards 1..N : venues paginées par tranche de URLS_PER_SHARD.
 *
 * Implémentation : on accumule en batches de 1000 (limite PostgREST par
 * défaut). ~31 batches × 12 shards par rebuild complet, exécuté 1x/24h grâce
 * à revalidate=86400.
 */
export async function buildVenueShard(shardIndex: number): Promise<SitemapEntry[]> {
  const sb = getSupabaseServerClient();
  const now = new Date().toISOString();
  const { start, end } = shardIdRange(shardIndex, VENUE_SHARD_COUNT);

  const venues: VenueRow[] = [];
  let cursor: string | null = null; // dernier id lu (keyset)
  while (venues.length < URLS_PER_SHARD) {
    let q = sb
      .from("venue")
      .select(
        "id, slug, updated_at, address, city_id, website_url, phone, description, primary_sport_slug, claim_status, enrichments",
      )
      .eq("is_published", true)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    // Borne basse : keyset (id > cursor) après la 1re page, sinon début de
    // tranche (id >= start). Pas d'OFFSET → l'index PK suffit, pas de timeout.
    q = cursor === null ? q.gte("id", start) : q.gt("id", cursor);
    if (end !== null) q = q.lt("id", end);

    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    venues.push(...(data as VenueRow[]));
    cursor = (data[data.length - 1] as VenueRow).id;
    // Page incomplète = fin de la tranche.
    if (data.length < PAGE_SIZE) break;
  }

  // Exclut les fiches trop pauvres (noindex côté page, #490) : on ne met dans
  // le sitemap QUE des URLs indexables. Filtre via la même fonction pure que le
  // gate noindex → cohérence garantie (une fiche noindexée n'est jamais listée).
  // Recalcul à la volée (0 migration) ; la carte reste exhaustive (elle ne passe
  // pas par le sitemap). Cf. #464/#465.
  return venues
    .filter((v) => !isLowQualityVenue(v))
    .slice(0, URLS_PER_SHARD)
    .map((v) =>
      localized(`/venue/${v.slug}`, {
        lastmod: v.updated_at ?? now,
        changefreq: "weekly",
        priority: 0.8,
      })
    );
}

type ClubRow = { id: string; slug: string; updated_at: string | null };

/**
 * Shard clubs (#398) : toutes les pages /club/[slug]. La table `club` est en
 * lecture publique (RLS USING(true), pas de soft-delete) → on liste tout.
 * Keyset par `id` (index PK) pour paginer au-delà du cap PostgREST de 1000,
 * sans OFFSET. ~4,4k clubs aujourd'hui, borné à URLS_PER_SHARD par sécurité.
 */
export async function buildClubShard(): Promise<SitemapEntry[]> {
  const sb = getSupabaseServerClient();
  const now = new Date().toISOString();

  const clubs: ClubRow[] = [];
  let cursor: string | null = null;
  while (clubs.length < URLS_PER_SHARD) {
    let q = sb
      .from("club")
      .select("id, slug, updated_at")
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (cursor !== null) q = q.gt("id", cursor);

    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    clubs.push(...(data as ClubRow[]));
    cursor = (data[data.length - 1] as ClubRow).id;
    if (data.length < PAGE_SIZE) break;
  }

  return clubs.slice(0, URLS_PER_SHARD).map((c) =>
    localized(`/club/${c.slug}`, {
      lastmod: c.updated_at ?? now,
      changefreq: "monthly",
      priority: 0.7,
    })
  );
}

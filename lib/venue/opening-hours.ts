/**
 * Parser minimaliste pour le format OpenStreetMap `opening_hours`.
 *
 * Supporte les patterns OSM les plus courants — ~70% des tags réels :
 *   - `24/7`
 *   - `Mo-Fr 09:00-22:00`
 *   - `Mo-Fr 09:00-12:00,14:00-18:00`
 *   - `Mo-Fr 09:00-22:00; Sa,Su 10:00-20:00`
 *   - `Mo,Tu,Th 18:00-22:00`
 *
 * Volontairement simple : on ne dépend pas de `opening_hours.js` (~30 KB
 * + dépendances bizarres). Tout cas exotique (PH, sunset, etc.) → on
 * retourne `null` et l'UI fallback sur l'affichage brut.
 *
 * Output adapté pour :
 *   1. Schema.org `openingHoursSpecification`
 *   2. Affichage humain dans la fiche venue
 */

const DAY_INDEX: Record<string, number> = {
  Mo: 0,
  Tu: 1,
  We: 2,
  Th: 3,
  Fr: 4,
  Sa: 5,
  Su: 6,
};

/** Ordre lisible : Lun..Dim. */
const DAY_ORDER: ReadonlyArray<keyof typeof DAY_INDEX> = [
  "Mo",
  "Tu",
  "We",
  "Th",
  "Fr",
  "Sa",
  "Su",
];

const DAY_NAME_SCHEMA: Record<string, string> = {
  Mo: "Monday",
  Tu: "Tuesday",
  We: "Wednesday",
  Th: "Thursday",
  Fr: "Friday",
  Sa: "Saturday",
  Su: "Sunday",
};

export type OpeningHoursSpec = {
  /** Jour (Mo, Tu, ...). */
  day: keyof typeof DAY_INDEX;
  /** Liste de plages HH:MM-HH:MM. */
  ranges: { open: string; close: string }[];
};

/**
 * Parse un tag OSM `opening_hours`. Retourne null si non parsable.
 *
 * Note: l'ordre des jours retournés suit l'ordre de la semaine (Mo..Su).
 */
export function parseOpeningHours(raw: string | null | undefined): OpeningHoursSpec[] | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Cas spécial 24/7
  if (trimmed === "24/7") {
    return DAY_ORDER.map((day) => ({
      day,
      ranges: [{ open: "00:00", close: "24:00" }],
    }));
  }

  const byDay = new Map<string, { open: string; close: string }[]>();

  // Sépare blocs par ";" — chaque bloc = un set de jours + ranges
  const blocks = trimmed.split(";").map((b) => b.trim()).filter(Boolean);
  for (const block of blocks) {
    // Match: "Mo-Fr 09:00-22:00" ou "Mo,Tu 09:00-22:00,14:00-18:00"
    const match = block.match(
      /^([A-Z][a-z](?:[-,][A-Z][a-z])*)\s+([\d:,\-]+)$/,
    );
    if (!match) return null;
    const daysSpec = match[1];
    const rangesSpec = match[2];

    // Expand "Mo-Fr" et "Mo,Sa"
    const days: (keyof typeof DAY_INDEX)[] = [];
    for (const part of daysSpec.split(",")) {
      if (part.includes("-")) {
        const [start, end] = part.split("-") as [
          keyof typeof DAY_INDEX,
          keyof typeof DAY_INDEX,
        ];
        const startIdx = DAY_INDEX[start];
        const endIdx = DAY_INDEX[end];
        if (startIdx == null || endIdx == null || endIdx < startIdx) return null;
        for (let i = startIdx; i <= endIdx; i++) {
          days.push(DAY_ORDER[i]);
        }
      } else {
        if (!(part in DAY_INDEX)) return null;
        days.push(part as keyof typeof DAY_INDEX);
      }
    }

    // Ranges: "09:00-22:00" ou "09:00-12:00,14:00-18:00"
    const ranges: { open: string; close: string }[] = [];
    for (const rangePart of rangesSpec.split(",")) {
      const rm = rangePart.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!rm) return null;
      const openH = rm[1].padStart(2, "0");
      const closeH = rm[3].padStart(2, "0");
      ranges.push({ open: `${openH}:${rm[2]}`, close: `${closeH}:${rm[4]}` });
    }

    for (const d of days) {
      byDay.set(d, ranges);
    }
  }

  if (byDay.size === 0) return null;

  return DAY_ORDER.filter((d) => byDay.has(d)).map((day) => ({
    day,
    ranges: byDay.get(day)!,
  }));
}

/**
 * Convertit un OpeningHoursSpec en JSON-LD schema.org
 * `OpeningHoursSpecification[]`.
 */
export function toSchemaOpeningHours(
  specs: OpeningHoursSpec[],
): Array<Record<string, unknown>> {
  const result: Record<string, unknown>[] = [];
  for (const spec of specs) {
    for (const range of spec.ranges) {
      result.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: DAY_NAME_SCHEMA[spec.day],
        opens: range.open,
        closes: range.close,
      });
    }
  }
  return result;
}

/**
 * Statut d'ouverture courant d'une venue.
 * Union discriminée : quand `isOpen` est vrai, `closesAt` est garanti.
 */
export type OpenStatus =
  | { isOpen: true; closesAt: string; opensAt?: string }
  | { isOpen: false; opensAt?: string };

/**
 * Calcule si la venue est ouverte « maintenant » à partir de specs parsées.
 *
 * Indicateur visuel approximatif : on raisonne dans le fuseau du serveur
 * (cf. revalidate côté page) faute de timezone par venue. Suffisant pour un
 * badge ouvert/fermé, pas pour de la logique métier.
 *
 * @param now injectable pour les tests (défaut : horloge courante).
 * @returns null si aucune plage exploitable, sinon le statut courant.
 */
export function getOpenStatus(
  specs: OpeningHoursSpec[] | null | undefined,
  now: Date = new Date(),
): OpenStatus | null {
  if (!specs || specs.length === 0) return null;

  // JS getDay : Dim=0..Sam=6 → notre index Mo=0..Su=6.
  const todayIdx = (now.getDay() + 6) % 7;
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const toMin = (t: string) => {
    const [h, m] = t.split(":");
    return parseInt(h, 10) * 60 + parseInt(m, 10);
  };

  const rangesByDayIdx = new Map<number, { open: string; close: string }[]>();
  for (const spec of specs) rangesByDayIdx.set(DAY_INDEX[spec.day], spec.ranges);

  // 1. Ouvert dans une plage d'aujourd'hui ? ("24:00" = 1440 → ouvert jusqu'à minuit)
  const todayRanges = rangesByDayIdx.get(todayIdx) ?? [];
  for (const r of todayRanges) {
    if (nowMin >= toMin(r.open) && nowMin < toMin(r.close)) {
      return { isOpen: true, closesAt: r.close };
    }
  }

  // 2. Fermé : prochaine plage plus tard aujourd'hui…
  const laterToday = todayRanges
    .filter((r) => toMin(r.open) > nowMin)
    .sort((a, b) => toMin(a.open) - toMin(b.open));
  if (laterToday.length > 0) {
    return { isOpen: false, opensAt: laterToday[0].open };
  }

  // 3. …sinon premier créneau des jours suivants.
  for (let offset = 1; offset <= 7; offset++) {
    const ranges = rangesByDayIdx.get((todayIdx + offset) % 7);
    if (ranges && ranges.length > 0) {
      const next = [...ranges].sort((a, b) => toMin(a.open) - toMin(b.open))[0];
      return { isOpen: false, opensAt: next.open };
    }
  }

  return { isOpen: false };
}

/**
 * Format lisible humain (ex: "9h-22h"). On garde court pour la grille mobile.
 */
export function formatRange(open: string, close: string, locale: "fr" | "en" | "zh"): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(":");
    const hh = parseInt(h, 10);
    if (locale === "fr") return m === "00" ? `${hh}h` : `${hh}h${m}`;
    if (locale === "zh") return m === "00" ? `${hh}:00` : `${hh}:${m}`;
    // en
    return m === "00" ? `${hh}:00` : `${hh}:${m}`;
  };
  return `${fmt(open)}-${fmt(close)}`;
}


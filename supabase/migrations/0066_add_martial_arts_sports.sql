-- 0066 — ajoute les disciplines d'arts martiaux manquantes à la taxonomie (#645).
--
-- Le rapport qualité (#645) a révélé ~79k venues sans `primary_sport_slug`, dont
-- ~50% sont des écoles d'arts martiaux dont la discipline n'avait PAS de slug
-- sport (taekwondo 8k, aikido 3k, kung-fu 3k, krav maga 1.8k…). Sans slug, ces
-- venues n'apparaissent sur aucune page sport. On ajoute 9 disciplines (famille
-- `combat`) ; le backfill par nom (`backfill_primary_sport.py --by-name`) les
-- assignera ensuite, et `lib/sports.ts` est mis à jour en miroir.
--
-- `venue.primary_sport_slug` a une FK → `sport(slug)` : ces lignes DOIVENT exister
-- avant tout backfill. Idempotent (ON CONFLICT DO NOTHING).
INSERT INTO sport (slug, name_fr, name_en, family_slug, emoji, color, position) VALUES
  ('taekwondo',    'Taekwondo',     'Taekwondo',     'combat', '🥋', '#b91c1c', 6),
  ('aikido',       'Aïkido',        'Aikido',        'combat', '🥋', '#b91c1c', 7),
  ('kung_fu',      'Kung-fu',       'Kung Fu',       'combat', '🥋', '#b91c1c', 8),
  ('krav_maga',    'Krav Maga',     'Krav Maga',     'combat', '🛡️', '#b91c1c', 9),
  ('kickboxing',   'Kickboxing',    'Kickboxing',    'combat', '🥊', '#b91c1c', 10),
  ('capoeira',     'Capoeira',      'Capoeira',      'combat', '🤸', '#b91c1c', 11),
  ('taichi',       'Tai-chi',       'Tai Chi',       'combat', '☯️', '#b91c1c', 12),
  ('kendo',        'Kendo',         'Kendo',         'combat', '🥋', '#b91c1c', 13),
  ('martial_arts', 'Arts martiaux', 'Martial arts',  'combat', '🥋', '#b91c1c', 14)
ON CONFLICT (slug) DO NOTHING;

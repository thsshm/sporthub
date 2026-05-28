export type Lang = "fr" | "en" | "zh";

export const STRINGS = {
  fr: {
    nav: {
      disciplines: "Disciplines",
      map: "Carte",
      favorites: "Favoris",
      open_menu: "Ouvrir le menu",
      close_menu: "Fermer le menu",
      change_lang: "Changer la langue",
      home: "Sport Hub — accueil",
    },
  },
  en: {
    nav: {
      disciplines: "Sports",
      map: "Map",
      favorites: "Favorites",
      open_menu: "Open menu",
      close_menu: "Close menu",
      change_lang: "Change language",
      home: "Sport Hub — home",
    },
  },
  zh: {
    nav: {
      disciplines: "运动",
      map: "地图",
      favorites: "收藏",
      open_menu: "打开菜单",
      close_menu: "关闭菜单",
      change_lang: "切换语言",
      home: "Sport Hub — 首页",
    },
  },
} as const;

export const DEFAULT_LANG: Lang = "fr";
export const STORAGE_KEY = "sporthub-lang";

/** Cycle FR → EN → ZH → FR. Utilisé par le toggle Nav. */
export function nextLang(current: Lang): Lang {
  if (current === "fr") return "en";
  if (current === "en") return "zh";
  return "fr";
}

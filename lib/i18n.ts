export type Lang = "fr" | "en";

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
} as const;

export const DEFAULT_LANG: Lang = "fr";
export const STORAGE_KEY = "sporthub-lang";

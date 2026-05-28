"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { FAMILIES } from "@/lib/families";

export function MobileNav() {
  const t = useTranslations("nav");
  const tFamilies = useTranslations("families");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
        onClick={() => setOpen(true)}
        aria-label={t("openMenu")}
        aria-expanded={open}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t("disciplines")}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">{t("disciplines")}</span>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setOpen(false)}
                aria-label={t("closeMenu")}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              {FAMILIES.map((family) => (
                <Link
                  key={family.slug}
                  href={`/sports/${family.sports[0]}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent"
                >
                  <span aria-hidden="true" className="text-lg">
                    {family.emoji}
                  </span>
                  <span>{tFamilies(family.slug)}</span>
                </Link>
              ))}
            </nav>
            <div className="border-t p-2">
              <Link
                href="/map"
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                {t("map")}
              </Link>
              <Link
                href="/favoris"
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                {t("favorites")}
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

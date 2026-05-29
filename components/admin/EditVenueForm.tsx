"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { editVenue } from "@/app/[locale]/admin/venues/actions";
import {
  venueEditSchema,
  type VenueEditInput,
} from "@/lib/venue/edit-schema";

type Initial = {
  name: string;
  description: string | null;
  website_url: string | null;
  phone: string | null;
  address: string | null;
  postal_code: string | null;
};

type FieldErrors = Partial<Record<keyof VenueEditInput, string>>;

type Props = {
  venueId: string;
  initial: Initial;
  disabled?: boolean;
};

export function EditVenueForm({ venueId, initial, disabled = false }: Props) {
  const t = useTranslations("admin.venues.edit");

  // État local pour les valeurs (optimistic UI : on garde ce qui a été tapé
  // pendant que le server action tourne).
  const [values, setValues] = useState({
    name: initial.name ?? "",
    description: initial.description ?? "",
    website_url: initial.website_url ?? "",
    phone: initial.phone ?? "",
    address: initial.address ?? "",
    postal_code: initial.postal_code ?? "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const update = <K extends keyof typeof values>(key: K, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);

    // Validation côté client pour feedback rapide
    const parsed = venueEditSchema.safeParse(values);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !(key in fe)) {
          fe[key as keyof VenueEditInput] = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    startTransition(async () => {
      const res = await editVenue(venueId, parsed.data);
      // Si redirect() côté server action a réussi, on n'arrive jamais ici.
      // Si on est là, c'est qu'il y a eu une erreur.
      if (res && !res.ok) {
        if ("fieldErrors" in res) {
          setErrors(res.fieldErrors);
        } else if ("formError" in res) {
          setFormError(res.formError);
        }
      }
    });
  };

  const isDisabled = disabled || isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field
        id="name"
        label={t("fieldName")}
        required
        error={errors.name && t(`errors.${errors.name}`)}
      >
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          disabled={isDisabled}
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
        />
      </Field>

      <Field
        id="description"
        label={t("fieldDescription")}
        error={errors.description && t(`errors.${errors.description}`)}
      >
        <textarea
          id="description"
          name="description"
          rows={5}
          maxLength={2000}
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
          disabled={isDisabled}
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
        />
      </Field>

      <Field
        id="website_url"
        label={t("fieldWebsite")}
        hint={t("fieldWebsiteHint")}
        error={errors.website_url && t(`errors.${errors.website_url}`)}
      >
        <input
          id="website_url"
          name="website_url"
          type="url"
          maxLength={500}
          placeholder="https://example.com"
          value={values.website_url}
          onChange={(e) => update("website_url", e.target.value)}
          disabled={isDisabled}
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
        />
      </Field>

      <Field
        id="phone"
        label={t("fieldPhone")}
        error={errors.phone && t(`errors.${errors.phone}`)}
      >
        <input
          id="phone"
          name="phone"
          type="tel"
          maxLength={200}
          value={values.phone}
          onChange={(e) => update("phone", e.target.value)}
          disabled={isDisabled}
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[2fr_1fr]">
        <Field
          id="address"
          label={t("fieldAddress")}
          error={errors.address && t(`errors.${errors.address}`)}
        >
          <input
            id="address"
            name="address"
            type="text"
            maxLength={2000}
            value={values.address}
            onChange={(e) => update("address", e.target.value)}
            disabled={isDisabled}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
        </Field>

        <Field
          id="postal_code"
          label={t("fieldPostalCode")}
          error={errors.postal_code && t(`errors.${errors.postal_code}`)}
        >
          <input
            id="postal_code"
            name="postal_code"
            type="text"
            maxLength={50}
            value={values.postal_code}
            onChange={(e) => update("postal_code", e.target.value)}
            disabled={isDisabled}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
        </Field>
      </div>

      {formError && (
        <p
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {t("formErrorPrefix")}: {formError}
        </p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isDisabled}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? t("submitPending") : t("submit")}
        </button>
        <a
          href="/admin/venues"
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          {t("cancel")}
        </a>
        {isPending && (
          <span
            aria-live="polite"
            className="text-xs text-muted-foreground"
          >
            {t("saving")}
          </span>
        )}
      </div>
    </form>
  );
}

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  children: React.ReactNode;
};

function Field({ id, label, hint, error, required, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

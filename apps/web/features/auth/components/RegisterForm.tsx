"use client";

import { Form } from "@base-ui/react/form";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRegister } from "@/features/auth/hooks/useAuthMutations";
import type { Locale } from "@/shared/i18n/locales";

type RegisterFormProps = {
  locale: Locale;
};

const copy: Record<
  Locale,
  {
    name: string;
    email: string;
    password: string;
    submit: string;
    submitting: string;
    nameRequired: string;
    emailInvalid: string;
    passwordTooShort: string;
    errorFallback: string;
  }
> = {
  en: {
    name: "Name",
    email: "Email",
    password: "Password",
    submit: "Create account",
    submitting: "Creating account…",
    nameRequired: "Name is required.",
    emailInvalid: "Enter a valid email address.",
    passwordTooShort: "Password must be at least 8 characters.",
    errorFallback: "Could not register.",
  },
  de: {
    name: "Name",
    email: "E-Mail",
    password: "Passwort",
    submit: "Konto erstellen",
    submitting: "Konto wird erstellt…",
    nameRequired: "Name ist erforderlich.",
    emailInvalid: "Bitte eine gültige E-Mail-Adresse eingeben.",
    passwordTooShort: "Das Passwort muss mindestens 8 Zeichen lang sein.",
    errorFallback: "Registrierung fehlgeschlagen.",
  },
};

/** Deliberately permissive — just "has an @ and something on both sides", mirrors apps/api's validation.ts. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Register form. Client-side `validate` on each field only prevents an
 * obviously-bad submit (empty name, malformed email, short password) —
 * apps/api re-validates everything server-side, which is the actual source
 * of truth (duplicate email, real password policy).
 */
export function RegisterForm({ locale }: RegisterFormProps) {
  const labels = copy[locale];
  const { mutate, isPending, isError, error } = useRegister();

  return (
    <Form
      className="flex flex-col gap-4"
      onFormSubmit={(values) => {
        mutate({
          name: String(values.name ?? ""),
          email: String(values.email ?? ""),
          password: String(values.password ?? ""),
        });
      }}
    >
      <Field
        name="name"
        validate={(value) => {
          if (typeof value !== "string" || value.trim().length === 0) {
            return labels.nameRequired;
          }
          return null;
        }}
      >
        <FieldLabel>{labels.name}</FieldLabel>
        <Input name="name" autoComplete="name" />
        <FieldError />
      </Field>

      <Field
        name="email"
        validate={(value) => {
          if (typeof value !== "string" || !EMAIL_PATTERN.test(value)) {
            return labels.emailInvalid;
          }
          return null;
        }}
      >
        <FieldLabel>{labels.email}</FieldLabel>
        <Input type="email" name="email" autoComplete="email" />
        <FieldError />
      </Field>

      <Field
        name="password"
        validate={(value) => {
          if (typeof value !== "string" || value.length < 8) {
            return labels.passwordTooShort;
          }
          return null;
        }}
      >
        <FieldLabel>{labels.password}</FieldLabel>
        <Input type="password" name="password" autoComplete="new-password" />
        <FieldError />
      </Field>

      <Button type="submit" disabled={isPending}>
        {isPending ? labels.submitting : labels.submit}
      </Button>

      {isError ? (
        <p className="text-sm text-destructive" role="alert">
          {error instanceof Error ? error.message : labels.errorFallback}
        </p>
      ) : null}
    </Form>
  );
}

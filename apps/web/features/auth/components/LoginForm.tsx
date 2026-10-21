"use client";

import { Form } from "@base-ui/react/form";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useLogin } from "@/features/auth/hooks/useAuthMutations";
import type { Locale } from "@/shared/i18n/locales";

type LoginFormProps = {
  locale: Locale;
};

const copy: Record<
  Locale,
  {
    email: string;
    password: string;
    submit: string;
    submitting: string;
    emailInvalid: string;
    passwordRequired: string;
    errorFallback: string;
  }
> = {
  en: {
    email: "Email",
    password: "Password",
    submit: "Log in",
    submitting: "Logging in…",
    emailInvalid: "Enter a valid email address.",
    passwordRequired: "Password is required.",
    errorFallback: "Could not log in.",
  },
  de: {
    email: "E-Mail",
    password: "Passwort",
    submit: "Anmelden",
    submitting: "Anmeldung läuft…",
    emailInvalid: "Bitte eine gültige E-Mail-Adresse eingeben.",
    passwordRequired: "Passwort ist erforderlich.",
    errorFallback: "Anmeldung fehlgeschlagen.",
  },
};

/** Deliberately permissive — just "has an @ and something on both sides", mirrors apps/api's validation.ts. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Login form. Client-side `validate` only catches obviously-bad input
 * (malformed email, empty password) before submitting — apps/api is the
 * actual source of truth for whether the credentials are correct, and
 * deliberately returns the same generic error for "unknown email" and
 * "wrong password" (see spec 0002-auth.md).
 */
export function LoginForm({ locale }: LoginFormProps) {
  const labels = copy[locale];
  const { mutate, isPending, isError, error } = useLogin();

  return (
    <Form
      className="flex flex-col gap-4"
      onFormSubmit={(values) => {
        mutate({
          email: String(values.email ?? ""),
          password: String(values.password ?? ""),
        });
      }}
    >
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
          if (typeof value !== "string" || value.length === 0) {
            return labels.passwordRequired;
          }
          return null;
        }}
      >
        <FieldLabel>{labels.password}</FieldLabel>
        <Input type="password" name="password" autoComplete="current-password" />
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

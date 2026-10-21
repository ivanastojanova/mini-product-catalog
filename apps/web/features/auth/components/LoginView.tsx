"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { RegisterForm } from "@/features/auth/components/RegisterForm";
import { useSession } from "@/features/auth/hooks/useSession";
import type { Locale } from "@/shared/i18n/locales";
import { localizedPath } from "@/shared/i18n/routing";

type LoginViewProps = {
  locale: Locale;
};

const copy: Record<Locale, { registerTab: string; loginTab: string }> = {
  en: { registerTab: "Create account", loginTab: "Log in" },
  de: { registerTab: "Konto erstellen", loginTab: "Anmelden" },
};

const tabClass = (active: boolean) =>
  active
    ? "border-b-2 border-foreground px-3 py-2 text-sm font-medium text-foreground"
    : "border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground";

/**
 * Logged-out entry point: register/login tabs. Once `useSession` reports a
 * customer (after either form succeeds, or if they were already logged in),
 * redirects to /account.
 */
export function LoginView({ locale }: LoginViewProps) {
  const labels = copy[locale];
  const router = useRouter();
  const { data: customer, isPending } = useSession();
  const [tab, setTab] = useState<"login" | "register">("login");

  useEffect(() => {
    if (customer) {
      router.replace(localizedPath(locale, "/account"));
    }
  }, [customer, locale, router]);

  if (isPending || customer) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-32" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("login")}
          aria-current={tab === "login" ? "page" : undefined}
          className={tabClass(tab === "login")}
        >
          {labels.loginTab}
        </button>
        <button
          type="button"
          onClick={() => setTab("register")}
          aria-current={tab === "register" ? "page" : undefined}
          className={tabClass(tab === "register")}
        >
          {labels.registerTab}
        </button>
      </div>

      {tab === "login" ? (
        <LoginForm locale={locale} />
      ) : (
        <RegisterForm locale={locale} />
      )}
    </div>
  );
}

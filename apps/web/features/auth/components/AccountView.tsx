"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLogout } from "@/features/auth/hooks/useAuthMutations";
import { useSession } from "@/features/auth/hooks/useSession";
import type { Locale } from "@/shared/i18n/locales";
import { localizedPath } from "@/shared/i18n/routing";

type AccountViewProps = {
  locale: Locale;
};

const copy: Record<
  Locale,
  {
    name: string;
    email: string;
    orders: string;
    logout: string;
    loggingOut: string;
  }
> = {
  en: {
    name: "Name",
    email: "Email",
    orders: "Your orders",
    logout: "Log out",
    loggingOut: "Logging out…",
  },
  de: {
    name: "Name",
    email: "E-Mail",
    orders: "Deine Bestellungen",
    logout: "Abmelden",
    loggingOut: "Wird abgemeldet…",
  },
};

/**
 * Logged-in-only account page content. The proxy already redirects requests
 * with no session cookie, but it can't tell a stale cookie from a valid one —
 * so this also redirects to /login when `useSession` says nobody's logged in
 * (which is also what fires right after logout).
 */
export function AccountView({ locale }: AccountViewProps) {
  const labels = copy[locale];
  const router = useRouter();
  const { data: customer, isPending } = useSession();
  const { mutate: logout, isPending: isLoggingOut } = useLogout();

  useEffect(() => {
    if (!isPending && !customer) {
      router.replace(localizedPath(locale, "/login"));
    }
  }, [customer, isPending, locale, router]);

  if (isPending || !customer) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-9 w-24" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{labels.name}</dt>
          <dd className="text-foreground">{customer.name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{labels.email}</dt>
          <dd className="text-foreground">{customer.email}</dd>
        </div>
      </dl>
      <Link
        href={localizedPath(locale, "/account/orders")}
        className="w-fit text-sm text-foreground underline-offset-4 hover:underline"
      >
        {labels.orders}
      </Link>
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={isLoggingOut}
        onClick={() => logout()}
      >
        {isLoggingOut ? labels.loggingOut : labels.logout}
      </Button>
    </div>
  );
}

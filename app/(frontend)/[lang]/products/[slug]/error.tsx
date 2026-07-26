"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getLocaleFromPathname, localizedPath } from "@/shared/i18n/routing";

type ProductErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ProductError({ error, reset }: ProductErrorProps) {
  const pathname = usePathname();
  const locale = getLocaleFromPathname(pathname);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-10 sm:px-6 lg:px-8">
      <h2 className="text-xl font-semibold tracking-tight">Something went wrong</h2>
      <p className="text-muted-foreground">{error.message}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Link
          href={localizedPath(locale)}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to catalog
        </Link>
      </div>
    </main>
  );
}

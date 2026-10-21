import { notFound } from "next/navigation";

import { AccountView } from "@/features/auth/components/AccountView";
import { isLocale, type Locale } from "@/shared/i18n/locales";

type AccountPageProps = {
  params: Promise<{ lang: string }>;
};

const copy: Record<Locale, { title: string }> = {
  en: { title: "Account" },
  de: { title: "Konto" },
};

export default async function AccountPage({ params }: AccountPageProps) {
  const { lang } = await params;

  if (!isLocale(lang)) {
    notFound();
  }

  const locale: Locale = lang;
  const { title } = copy[locale];

  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-10">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      <AccountView locale={locale} />
    </main>
  );
}

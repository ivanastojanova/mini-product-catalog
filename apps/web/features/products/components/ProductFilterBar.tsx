"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EMPTY_DRAFT,
  draftToFilters,
  filtersToDraft,
  type FilterDraft,
} from "@/features/products/lib/filterDraft";
import {
  MAX_SEARCH_LENGTH,
  SORT_KEYS,
  serializeProductFilters,
  type ProductFilters,
  type SortKey,
} from "@/features/products/lib/productFilters";
import type { ProductCategory } from "@/features/products/types/product";
import type { Locale } from "@/shared/i18n/locales";

type ProductFilterBarProps = {
  locale: Locale;
  categories: ProductCategory[];
  /** Already parsed and validated by the page; the bar never reads the raw URL. */
  filters: ProductFilters;
};

type Copy = {
  search: string;
  searchPlaceholder: string;
  category: string;
  allCategories: string;
  minPrice: string;
  maxPrice: string;
  inStock: string;
  minQty: string;
  sort: string;
  sortOptions: Record<SortKey, string>;
  clear: string;
  updating: string;
};

const copy: Record<Locale, Copy> = {
  en: {
    search: "Search",
    searchPlaceholder: "Search products",
    category: "Category",
    allCategories: "All categories",
    minPrice: "Min price",
    maxPrice: "Max price",
    inStock: "In stock only",
    minQty: "Min. available",
    sort: "Sort by",
    sortOptions: {
      title: "Name, A to Z",
      "title-desc": "Name, Z to A",
      "price-asc": "Price, low to high",
      "price-desc": "Price, high to low",
    },
    clear: "Clear filters",
    updating: "Updating…",
  },
  de: {
    search: "Suche",
    searchPlaceholder: "Produkte suchen",
    category: "Kategorie",
    allCategories: "Alle Kategorien",
    minPrice: "Mindestpreis",
    maxPrice: "Höchstpreis",
    inStock: "Nur auf Lager",
    minQty: "Mind. verfügbar",
    sort: "Sortieren nach",
    sortOptions: {
      title: "Name, A bis Z",
      "title-desc": "Name, Z bis A",
      "price-asc": "Preis, aufsteigend",
      "price-desc": "Preis, absteigend",
    },
    clear: "Filter zurücksetzen",
    updating: "Wird aktualisiert…",
  },
};

const DEBOUNCE_MS = 350;

function isDefault(draft: FilterDraft): boolean {
  return (Object.keys(EMPTY_DRAFT) as (keyof FilterDraft)[]).every(
    (key) => draft[key] === EMPTY_DRAFT[key],
  );
}

/**
 * The catalog's single search and filter bar. All state lives in the URL
 * (shareable, survives reload); the inputs hold a local draft so typing is not
 * fought by the server round trip. The draft goes through the same parser the
 * page uses, so only valid values ever reach the URL.
 */
export function ProductFilterBar({
  locale,
  categories,
  filters,
}: ProductFilterBarProps) {
  const labels = copy[locale];
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const knownCategories = categories.map((category) => category.slug);
  const urlKey = serializeProductFilters(filters).toString();

  const categoryItems = [
    { value: null, label: labels.allCategories },
    ...categories.map((category) => ({
      value: category.slug,
      label: category.name,
    })),
  ];
  const sortItems = SORT_KEYS.map((key) => ({
    value: key,
    label: labels.sortOptions[key],
  }));

  const [draft, setDraft] = useState<FilterDraft>(() => filtersToDraft(filters));
  const [typing, setTyping] = useState(false);
  const [seenUrlKey, setSeenUrlKey] = useState(urlKey);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Back/forward or a link changed the URL under us: show what the page is showing.
  // Skipped while the shopper is mid-edit, so a slow response never overwrites typing.
  if (urlKey !== seenUrlKey) {
    setSeenUrlKey(urlKey);
    if (!typing && !isPending) {
      const draftKey = serializeProductFilters(
        draftToFilters(draft, knownCategories),
      ).toString();
      if (draftKey !== urlKey) {
        setDraft(filtersToDraft(filters));
      }
    }
  }

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  function navigate(next: FilterDraft) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setTyping(false);

    const query = serializeProductFilters(
      draftToFilters(next, knownCategories),
    ).toString();
    if (query === urlKey) {
      return;
    }

    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  }

  function update(patch: Partial<FilterDraft>, debounced: boolean) {
    const next = { ...draft, ...patch };
    setDraft(next);

    if (!debounced) {
      navigate(next);
      return;
    }

    setTyping(true);
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => navigate(next), DEBOUNCE_MS);
  }

  function clear() {
    setDraft(EMPTY_DRAFT);
    navigate(EMPTY_DRAFT);
  }

  return (
    <form
      role="search"
      className="mb-8 flex flex-col gap-4"
      aria-busy={isPending}
      onSubmit={(event) => {
        event.preventDefault();
        navigate(draft);
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
          {labels.search}
          <Input
            type="search"
            name="q"
            value={draft.q}
            maxLength={MAX_SEARCH_LENGTH}
            placeholder={labels.searchPlaceholder}
            onChange={(event) => update({ q: event.target.value }, true)}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <Select
            items={categoryItems}
            value={draft.category || null}
            onValueChange={(value) => {
              if (value === null || typeof value === "string") {
                update({ category: value ?? "" }, false);
              }
            }}
          >
            <SelectLabel>{labels.category}</SelectLabel>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryItems.map((item) => (
                <SelectItem key={item.value ?? "all"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Select
            items={sortItems}
            value={draft.sort}
            onValueChange={(value) => {
              if (typeof value === "string") {
                update({ sort: value }, false);
              }
            }}
          >
            <SelectLabel>{labels.sort}</SelectLabel>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {labels.minPrice}
          <Input
            type="text"
            inputMode="decimal"
            name="min"
            value={draft.min}
            onChange={(event) => update({ min: event.target.value }, true)}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {labels.maxPrice}
          <Input
            type="text"
            inputMode="decimal"
            name="max"
            value={draft.max}
            onChange={(event) => update({ max: event.target.value }, true)}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {labels.minQty}
          <Input
            type="text"
            inputMode="numeric"
            name="minQty"
            value={draft.minQty}
            onChange={(event) => update({ minQty: event.target.value }, true)}
          />
        </label>

        <label className="flex items-center gap-2 self-end pb-1.5 text-sm font-medium">
          <Checkbox
            name="inStock"
            checked={draft.inStock}
            onCheckedChange={(checked) =>
              update({ inStock: checked }, false)
            }
          />
          {labels.inStock}
        </label>
      </div>

      <div className="flex min-h-8 items-center gap-3">
        {!isDefault(draft) && (
          <Button type="button" variant="outline" size="sm" onClick={clear}>
            {labels.clear}
          </Button>
        )}
        <span
          role="status"
          className="text-sm text-muted-foreground"
          aria-live="polite"
        >
          {isPending || typing ? labels.updating : ""}
        </span>
      </div>
    </form>
  );
}

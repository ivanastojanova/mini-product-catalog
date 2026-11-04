/**
 * Category seed – run with:
 *   npm run seed:categories
 *
 * Additive and safe to re-run, unlike `seed/products.ts` (which deletes and
 * recreates every product). Creates any missing category (EN + DE name) and
 * assigns one to each listed product that has none yet. It never edits an
 * existing category and never replaces a category an editor already chose.
 */
import { getPayload } from "payload";
import config from "@payload-config";

import { notifyRevalidate } from "../lib/notifyRevalidate";

type SeedCategory = { slug: string; en: string; de: string };

const categories: SeedCategory[] = [
  { slug: "lighting", en: "Lighting", de: "Beleuchtung" },
  { slug: "seating", en: "Seating", de: "Sitzmöbel" },
  { slug: "tables", en: "Tables", de: "Tische" },
  { slug: "storage", en: "Storage", de: "Aufbewahrung" },
  { slug: "beds", en: "Beds", de: "Betten" },
];

const categoryByProduct: Record<string, string> = {
  "aarhus-floor-lamp": "lighting",
  "malmo-lounge-chair": "seating",
  "aalborg-3-seat-sofa": "seating",
  "bergen-dining-table": "tables",
  "stockholm-coffee-table": "tables",
  "gothenburg-desk": "tables",
  "oslo-bookshelf": "storage",
  "copenhagen-sideboard": "storage",
  "trondheim-wardrobe": "storage",
  "helsinki-bed-frame": "beds",
};

async function seed() {
  const payload = await getPayload({ config });
  const quiet = { disableRevalidate: true };

  const idBySlug = new Map<string, number | string>();

  for (const category of categories) {
    const found = await payload.find({
      collection: "categories",
      where: { slug: { equals: category.slug } },
      limit: 1,
      depth: 0,
    });

    const existing = found.docs[0];
    if (existing) {
      idBySlug.set(category.slug, existing.id);
      payload.logger.info(`= category ${category.slug} (already there)`);
      continue;
    }

    const created = await payload.create({
      collection: "categories",
      locale: "en",
      data: { slug: category.slug, name: category.en },
      context: quiet,
    });
    await payload.update({
      collection: "categories",
      id: created.id,
      locale: "de",
      data: { name: category.de },
      context: quiet,
    });
    idBySlug.set(category.slug, created.id);
    payload.logger.info(`+ category ${category.slug}`);
  }

  for (const [productSlug, categorySlug] of Object.entries(categoryByProduct)) {
    const categoryId = idBySlug.get(categorySlug);
    const found = await payload.find({
      collection: "products",
      where: { slug: { equals: productSlug } },
      limit: 1,
      depth: 0,
    });

    const product = found.docs[0];
    if (!product || categoryId === undefined) {
      payload.logger.warn(`! ${productSlug}: product or category not found, skipped`);
      continue;
    }
    if (product.category != null) {
      payload.logger.info(`= ${productSlug} (already has a category)`);
      continue;
    }

    await payload.update({
      collection: "products",
      id: product.id,
      data: { category: categoryId as number },
      context: quiet,
    });
    payload.logger.info(`+ ${productSlug} -> ${categorySlug}`);
  }

  // One refresh of the storefront listing instead of one per write.
  await notifyRevalidate({});

  payload.logger.info("Category seed done.");
  process.exit(0);
}

await seed();

import { db } from "../db/client.js";
import { listProductSlugs } from "../cart/lib/cmsClient.js";
import { DEFAULT_SEED_STOCK } from "./lib/inventoryConfig.js";
import { seedInventory } from "./lib/inventoryRepo.js";

/**
 * `npm run db:seed-inventory --workspace=apps/api` — gives every CMS product
 * that has no inventory row yet DEFAULT_SEED_STOCK units. Safe to re-run (e.g.
 * after adding products in the CMS): existing rows are left alone. Needs
 * apps/cms running. Stock is edited afterwards in the DB (Drizzle Studio).
 */
const slugs = await listProductSlugs();
const added = seedInventory(db, slugs, DEFAULT_SEED_STOCK);

console.log(
  `CMS has ${slugs.length} product(s); added inventory for ${added.length}` +
    (added.length > 0 ? `: ${added.join(", ")}` : "") +
    `; ${slugs.length - added.length} already had a row.`,
);

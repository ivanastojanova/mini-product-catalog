/** Units given to a product the first time it is seeded. Existing inventory rows are never touched. */
export const DEFAULT_SEED_STOCK = 10;

/** Most slugs one `GET /stock?slugs=` call will answer. Bounds the `IN (...)` list and the response size. */
export const MAX_STOCK_BATCH_SLUGS = 100;

/** Longest slug accepted in a batch, matching the single-slug route's path-param limit. */
export const MAX_STOCK_SLUG_LENGTH = 100;

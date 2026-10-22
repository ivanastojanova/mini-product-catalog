export const productKeys = {
  all: ["products"] as const,
  stock: (slug: string) => [...productKeys.all, "stock", slug] as const,
};

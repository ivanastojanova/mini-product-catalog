export const productKeys = {
  all: ["products"] as const,
  allStock: () => [...productKeys.all, "stock"] as const,
  stock: (slug: string) => [...productKeys.all, "stock", slug] as const,
};

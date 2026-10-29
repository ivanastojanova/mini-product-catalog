export const orderKeys = {
  all: ["orders"] as const,
  list: () => [...orderKeys.all, "list"] as const,
  detail: (publicId: string) => [...orderKeys.all, "detail", publicId] as const,
};

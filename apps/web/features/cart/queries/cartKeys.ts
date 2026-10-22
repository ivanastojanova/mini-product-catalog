export const cartKeys = {
  all: ["cart"] as const,
  current: () => [...cartKeys.all, "current"] as const,
};

export type CartItem = {
  slug: string;
  quantity: number;
};

export type AddToCartResponse = {
  slug: string;
  quantity: number;
  addedAt: string;
};

export type AddToCartError = {
  message: string;
};

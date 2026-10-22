export type CartLine = {
  slug: string;
  quantity: number;
};

export type Cart = {
  items: CartLine[];
};

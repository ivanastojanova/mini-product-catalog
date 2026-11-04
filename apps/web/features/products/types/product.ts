export type ProductSpecification = {
  label: string;
  value: string;
};

export type ProductImage = {
  id: string;
  url?: string | null;
  alt: string;
};

export type ProductCategory = {
  slug: string;
  /** Localized label for the requested locale. */
  name: string;
};

export type Product = {
  id: string;
  slug: string;
  price: number;
  currency: string;
  title: string;
  description?: string;
  category?: ProductCategory;
  images?: ProductImage[];
  specifications?: ProductSpecification[];
};

export type ProductStock = {
  slug: string;
  inStock: boolean;
  quantity: number;
  updatedAt: string;
};

import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionConfig,
} from "payload";

import { notifyRevalidate } from "../lib/notifyRevalidate";

type RevalidateContext = {
  disableRevalidate?: boolean;
};

/**
 * Products embed their category (name and slug), so a category edit changes
 * the storefront listing. No slug is sent: the webhook then refreshes only
 * the `products` listing tag. See docs/adr/0002-webhook-based-revalidation.md.
 */
const revalidateListing: CollectionAfterChangeHook &
  CollectionAfterDeleteHook = async ({ doc, context }) => {
  if (!(context as RevalidateContext).disableRevalidate) {
    await notifyRevalidate({});
  }
  return doc;
};

/** Lowercase words joined by single hyphens: safe to put in a URL and to compare with `equals`. */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const Category: CollectionConfig = {
  slug: "categories",
  admin: {
    useAsTitle: "name",
  },
  access: {
    read: () => true,
  },
  hooks: {
    afterChange: [revalidateListing],
    afterDelete: [revalidateListing],
  },
  fields: [
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      index: true,
      maxLength: 60,
      validate: (value: string | null | undefined) =>
        value && CATEGORY_SLUG_PATTERN.test(value)
          ? true
          : "Use lowercase letters, numbers and single hyphens (e.g. floor-lamps).",
      admin: {
        description:
          "Used in storefront URLs (?category=...). Changing it breaks existing links.",
      },
    },
    {
      name: "name",
      type: "text",
      required: true,
      localized: true,
    },
  ],
};

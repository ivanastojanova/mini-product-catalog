import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionConfig,
} from "payload";

import type { Product as PayloadProduct } from "../payload-types";
import { notifyRevalidate } from "../lib/notifyRevalidate";

type RevalidateContext = {
  disableRevalidate?: boolean;
};

async function invalidateProductCache(args: {
  slug?: string | null;
  previousSlug?: string | null;
  context?: RevalidateContext;
}) {
  if (args.context?.disableRevalidate) {
    return;
  }

  // apps/cms and apps/web are separate processes now — notify the
  // storefront over HTTP (webhook-style) instead of calling `revalidateTag`
  // in-process. See docs/adr/0002-webhook-based-revalidation.md.
  await notifyRevalidate({
    slug: args.slug,
    previousSlug: args.previousSlug,
  });
}

const revalidateAfterChange: CollectionAfterChangeHook<PayloadProduct> = async ({
  doc,
  previousDoc,
  context,
}) => {
  await invalidateProductCache({
    slug: doc.slug,
    previousSlug: previousDoc?.slug,
    context: context as RevalidateContext,
  });
  return doc;
};

const revalidateAfterDelete: CollectionAfterDeleteHook<PayloadProduct> = async ({
  doc,
  context,
}) => {
  await invalidateProductCache({
    slug: doc.slug,
    context: context as RevalidateContext,
  });
  return doc;
};

export const Product: CollectionConfig = {
  slug: "products",
  admin: {
    useAsTitle: "title",
  },
  access: {
    read: () => true,
  },
  hooks: {
    afterChange: [revalidateAfterChange],
    afterDelete: [revalidateAfterDelete],
  },
  fields: [
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      index: true,
    },
    {
      name: "price",
      type: "number",
      required: true,
    },
    {
      name: "currency",
      type: "text",
      required: true,
      defaultValue: "EUR",
    },
    {
      name: "title",
      type: "text",
      required: true,
      localized: true,
    },
    {
      name: "description",
      type: "textarea",
      localized: true,
    },
    {
      name: "images",
      type: "upload",
      relationTo: "media",
      hasMany: true,
    },
    {
      name: "specifications",
      type: "array",
      localized: true,
      fields: [
        {
          name: "label",
          type: "text",
          required: true,
        },
        {
          name: "value",
          type: "text",
          required: true,
        },
      ],
    },
  ],
};

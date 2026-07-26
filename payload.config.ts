import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "path";
import { buildConfig } from "payload";
import { fileURLToPath } from "url";
import sharp from "sharp";

import { Product } from "./collections/Product";
import { Media } from "./collections/Media";
import { Users } from "./collections/Users";
import { i18nConfig } from "./shared/i18n/config";
import { defaultLocale, locales } from "./shared/i18n/locales";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, Product],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || "",
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || "",
    },
  }),
  localization: {
    locales: locales.map((code) => ({
      code,
      label: i18nConfig.labels[code],
    })),
    defaultLocale,
    fallback: true,
  },
  sharp,
});

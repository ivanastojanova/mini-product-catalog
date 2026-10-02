/**
 * Seed script – run with:
 *   npm run seed
 *
 * Creates products in both EN and DE locales.
 */
import { getPayload } from "payload";
import config from "@payload-config";

type Spec = { label: string; value: string };

type LocalizedProduct = {
  slug: string;
  price: number;
  currency: string;
  en: {
    title: string;
    description: string;
    specifications: Spec[];
  };
  de: {
    title: string;
    description: string;
    specifications: Spec[];
  };
};

const products: LocalizedProduct[] = [
  {
    slug: "malmo-lounge-chair",
    price: 745,
    currency: "EUR",
    en: {
      title: "Malmö Lounge Chair",
      description:
        "A sculptural lounge chair with a gently curved backrest. Ideal for reading corners and quiet living spaces.",
      specifications: [
        { label: "Dimensions", value: "78 × 82 × 76 cm" },
        { label: "Material", value: "Wool blend fabric" },
        { label: "Colour", value: "Oatmeal" },
        { label: "Frame", value: "Oak" },
        { label: "Weight", value: "18 kg" },
      ],
    },
    de: {
      title: "Malmö Lounge-Sessel",
      description:
        "Ein skulpturaler Lounge-Sessel mit sanft geschwungener Rückenlehne. Ideal für Leseecken und ruhige Wohnräume.",
      specifications: [
        { label: "Abmessungen", value: "78 × 82 × 76 cm" },
        { label: "Material", value: "Wollmischgewebe" },
        { label: "Farbe", value: "Haferflocken" },
        { label: "Gestell", value: "Eiche" },
        { label: "Gewicht", value: "18 kg" },
      ],
    },
  },
  {
    slug: "bergen-dining-table",
    price: 1290,
    currency: "EUR",
    en: {
      title: "Bergen Dining Table",
      description:
        "A solid oak dining table with a refined matt finish. Seats six comfortably without overwhelming smaller rooms.",
      specifications: [
        { label: "Dimensions", value: "180 × 90 × 75 cm" },
        { label: "Material", value: "Solid oak" },
        { label: "Colour", value: "Natural oak" },
        { label: "Finish", value: "Matt lacquer" },
        { label: "Weight", value: "52 kg" },
      ],
    },
    de: {
      title: "Bergen Esstisch",
      description:
        "Ein massiver Esstisch aus Eiche mit feiner Mattlackierung. Bietet Platz für sechs Personen, ohne kleinere Räume zu überladen.",
      specifications: [
        { label: "Abmessungen", value: "180 × 90 × 75 cm" },
        { label: "Material", value: "Massive Eiche" },
        { label: "Farbe", value: "Natureiche" },
        { label: "Oberfläche", value: "Mattlack" },
        { label: "Gewicht", value: "52 kg" },
      ],
    },
  },
  {
    slug: "oslo-bookshelf",
    price: 620,
    currency: "EUR",
    en: {
      title: "Oslo Bookshelf",
      description:
        "An open oak bookshelf with five adjustable shelves. Designed for airy storage in contemporary interiors.",
      specifications: [
        { label: "Dimensions", value: "90 × 35 × 200 cm" },
        { label: "Material", value: "Oak veneer" },
        { label: "Colour", value: "White oak" },
        { label: "Shelves", value: "5 adjustable" },
        { label: "Weight", value: "41 kg" },
      ],
    },
    de: {
      title: "Oslo Bücherregal",
      description:
        "Ein offenes Bücherregal aus Eiche mit fünf verstellbaren Böden. Für luftige Aufbewahrung in modernen Interieurs.",
      specifications: [
        { label: "Abmessungen", value: "90 × 35 × 200 cm" },
        { label: "Material", value: "Eichenfurnier" },
        { label: "Farbe", value: "Weißeiche" },
        { label: "Böden", value: "5 verstellbar" },
        { label: "Gewicht", value: "41 kg" },
      ],
    },
  },
  {
    slug: "copenhagen-sideboard",
    price: 980,
    currency: "EUR",
    en: {
      title: "Copenhagen Sideboard",
      description:
        "A low sideboard with soft-close doors and generous storage. Soft walnut tones pair well with both light and dark rooms.",
      specifications: [
        { label: "Dimensions", value: "160 × 45 × 75 cm" },
        { label: "Material", value: "Walnut veneer" },
        { label: "Colour", value: "Walnut" },
        { label: "Doors", value: "3 soft-close" },
        { label: "Weight", value: "55 kg" },
      ],
    },
    de: {
      title: "Copenhagen Sideboard",
      description:
        "Ein niedriges Sideboard mit Soft-Close-Türen und großzügigem Stauraum. Warme Walnusztöne passen zu hellen und dunklen Räumen.",
      specifications: [
        { label: "Abmessungen", value: "160 × 45 × 75 cm" },
        { label: "Material", value: "Walnussfurnier" },
        { label: "Farbe", value: "Walnuss" },
        { label: "Türen", value: "3 Soft-Close" },
        { label: "Gewicht", value: "55 kg" },
      ],
    },
  },
  {
    slug: "stockholm-coffee-table",
    price: 390,
    currency: "EUR",
    en: {
      title: "Stockholm Coffee Table",
      description:
        "A round coffee table with a slim metal base and stone-look top. A calm centrepiece for living rooms.",
      specifications: [
        { label: "Dimensions", value: "Ø 90 × 40 cm" },
        { label: "Top", value: "Ceramic stoneware" },
        { label: "Colour", value: "Warm grey" },
        { label: "Base", value: "Powder-coated steel" },
        { label: "Weight", value: "22 kg" },
      ],
    },
    de: {
      title: "Stockholm Couchtisch",
      description:
        "Ein runder Couchtisch mit schlankem Metallgestell und Steinoptik-Platte. Ein ruhiger Mittelpunkt für Wohnzimmer.",
      specifications: [
        { label: "Abmessungen", value: "Ø 90 × 40 cm" },
        { label: "Platte", value: "Keramik-Steingut" },
        { label: "Farbe", value: "Warmgrau" },
        { label: "Gestell", value: "Pulverbeschichteter Stahl" },
        { label: "Gewicht", value: "22 kg" },
      ],
    },
  },
  {
    slug: "helsinki-bed-frame",
    price: 1120,
    currency: "EUR",
    en: {
      title: "Helsinki Bed Frame",
      description:
        "A queen-size bed frame with an upholstered headboard and solid wood slats. Built for quiet nights and clean proportions.",
      specifications: [
        { label: "Dimensions", value: "160 × 200 cm (mattress)" },
        { label: "Material", value: "Bouclé fabric" },
        { label: "Colour", value: "Ivory" },
        { label: "Slats", value: "Solid pine" },
        { label: "Weight", value: "48 kg" },
      ],
    },
    de: {
      title: "Helsinki Bettgestell",
      description:
        "Ein Queensize-Bettgestell mit gepolstertem Kopfteil und massiven Holzlatten. Für ruhige Nächte und klare Proportionen.",
      specifications: [
        { label: "Abmessungen", value: "160 × 200 cm (Matratze)" },
        { label: "Material", value: "Bouclé-Stoff" },
        { label: "Farbe", value: "Elfenbein" },
        { label: "Latten", value: "Massive Kiefer" },
        { label: "Gewicht", value: "48 kg" },
      ],
    },
  },
  {
    slug: "gothenburg-desk",
    price: 540,
    currency: "EUR",
    en: {
      title: "Gothenburg Desk",
      description:
        "A compact work desk with a cable tray and tapered legs. Suited to home offices that need focus without bulk.",
      specifications: [
        { label: "Dimensions", value: "120 × 60 × 75 cm" },
        { label: "Material", value: "Ash veneer" },
        { label: "Colour", value: "Light ash" },
        { label: "Features", value: "Integrated cable tray" },
        { label: "Weight", value: "27 kg" },
      ],
    },
    de: {
      title: "Gothenburg Schreibtisch",
      description:
        "Ein kompakter Schreibtisch mit Kabelwanne und konischen Beinen. Ideal für Home Offices, die Fokus ohne Sperrigkeit brauchen.",
      specifications: [
        { label: "Abmessungen", value: "120 × 60 × 75 cm" },
        { label: "Material", value: "Eschenfurnier" },
        { label: "Farbe", value: "Helle Esche" },
        { label: "Features", value: "Integrierte Kabelwanne" },
        { label: "Gewicht", value: "27 kg" },
      ],
    },
  },
  {
    slug: "trondheim-wardrobe",
    price: 1450,
    currency: "EUR",
    en: {
      title: "Trondheim Wardrobe",
      description:
        "A two-door wardrobe with hanging rail, shelves, and soft interior lighting. Calm storage for everyday clothing.",
      specifications: [
        { label: "Dimensions", value: "120 × 60 × 210 cm" },
        { label: "Material", value: "Painted MDF / oak" },
        { label: "Colour", value: "Soft white / oak" },
        { label: "Interior", value: "Rail + 4 shelves" },
        { label: "Weight", value: "89 kg" },
      ],
    },
    de: {
      title: "Trondheim Kleiderschrank",
      description:
        "Ein zweitüriger Kleiderschrank mit Kleiderstange, Böden und sanfter Innenbeleuchtung. Ruhige Aufbewahrung für den Alltag.",
      specifications: [
        { label: "Abmessungen", value: "120 × 60 × 210 cm" },
        { label: "Material", value: "Lackiertes MDF / Eiche" },
        { label: "Farbe", value: "Sanftes Weiß / Eiche" },
        { label: "Innenleben", value: "Stange + 4 Böden" },
        { label: "Gewicht", value: "89 kg" },
      ],
    },
  },
  {
    slug: "aarhus-floor-lamp",
    price: 265,
    currency: "EUR",
    en: {
      title: "Aarhus Floor Lamp",
      description:
        "A minimal floor lamp with an adjustable linen shade. Soft ambient light for evenings and reading nooks.",
      specifications: [
        { label: "Dimensions", value: "Ø 40 × 155 cm" },
        { label: "Material", value: "Brushed steel / linen" },
        { label: "Colour", value: "Brushed nickel / ivory" },
        { label: "Bulb", value: "E27, max 40W LED" },
        { label: "Weight", value: "6 kg" },
      ],
    },
    de: {
      title: "Aarhus Stehlampe",
      description:
        "Eine minimale Stehlampe mit verstellbarem Leinenschirm. Sanftes Umgebungslicht für Abende und Leseecken.",
      specifications: [
        { label: "Abmessungen", value: "Ø 40 × 155 cm" },
        { label: "Material", value: "Gebürsteter Stahl / Leinen" },
        { label: "Farbe", value: "Nickel gebürstet / Elfenbein" },
        { label: "Leuchtmittel", value: "E27, max. 40W LED" },
        { label: "Gewicht", value: "6 kg" },
      ],
    },
  },
];

async function seed() {
  const payload = await getPayload({ config });

  payload.logger.info("Seeding furniture products (EN + DE)...");

  const existing = await payload.find({
    collection: "products",
    limit: 1000,
    depth: 0,
  });

  if (existing.docs.length > 0) {
    payload.logger.info(
      `Clearing ${existing.docs.length} existing product(s)...`,
    );
    await payload.delete({
      collection: "products",
      where: {
        id: {
          in: existing.docs.map((doc) => doc.id),
        },
      },
      context: {
        disableRevalidate: true,
      },
    });
  }

  for (const product of products) {
    const created = await payload.create({
      collection: "products",
      locale: "en",
      data: {
        slug: product.slug,
        price: product.price,
        currency: product.currency,
        title: product.en.title,
        description: product.en.description,
        specifications: product.en.specifications,
      },
      context: {
        disableRevalidate: true,
      },
    });

    await payload.update({
      collection: "products",
      id: created.id,
      locale: "de",
      data: {
        title: product.de.title,
        description: product.de.description,
        specifications: product.de.specifications,
      },
      context: {
        disableRevalidate: true,
      },
    });

    payload.logger.info(`✓ ${product.slug}`);
  }

  payload.logger.info(`Seeded ${products.length} products.`);
  process.exit(0);
}

await seed();

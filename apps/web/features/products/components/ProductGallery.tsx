"use client";

import Image from "next/image";
import { useState } from "react";

import type { ProductImage } from "@/features/products/types/product";
import { cn } from "@/lib/utils";

type ProductGalleryProps = {
  images?: ProductImage[];
  title: string;
};

export function ProductGallery({ images, title }: ProductGalleryProps) {
  const gallery = (images ?? []).filter((image) => Boolean(image.url));
  const [activeIndex, setActiveIndex] = useState(0);
  const active = gallery[activeIndex] ?? gallery[0];

  if (!active?.url) {
    return (
      <div
        className="flex aspect-square w-full items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground"
        role="img"
        aria-label={`${title} — no image available`}
      >
        No image
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted">
        <Image
          key={active.id}
          src={active.url}
          alt={active.alt || title}
          fill
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
        />
      </div>

      {gallery.length > 1 ? (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5" aria-label="Product images">
          {gallery.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Show image ${index + 1}`}
                aria-pressed={index === activeIndex}
                className={cn(
                  "relative aspect-square w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                  index === activeIndex && "ring-2 ring-foreground",
                )}
              >
                {image.url ? (
                  <Image
                    src={image.url}
                    alt={image.alt || `${title} thumbnail ${index + 1}`}
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

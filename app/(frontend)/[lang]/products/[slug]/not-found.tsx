import Link from "next/link";

export default function ProductNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-4 py-10 sm:px-6 lg:px-8">
      <h2 className="text-xl font-semibold tracking-tight">Product not found</h2>
      <p className="text-muted-foreground">
        The product you are looking for does not exist or may have been removed.
      </p>
      <p>
        <Link
          href="/"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Back to catalog
        </Link>
      </p>
    </main>
  );
}

/**
 * Holds the Idempotency-Key for one checkout attempt. The key is created lazily
 * on first use and then handed out unchanged, so a double click or a retry after
 * a lost response sends the SAME key and apps/api returns the same order instead
 * of holding stock twice. `reset()` starts a new attempt with a new key.
 */
export type KeyHolder = {
  current: () => string;
  reset: () => void;
};

export function createKeyHolder(generate: () => string): KeyHolder {
  let key: string | null = null;

  return {
    current() {
      key ??= generate();
      return key;
    },
    reset() {
      key = null;
    },
  };
}

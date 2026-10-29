/** Whole seconds left until `expiresAt`, never negative. */
export function secondsUntil(expiresAt: string, now: number): number {
  const remaining = Math.ceil((new Date(expiresAt).getTime() - now) / 1000);
  return Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
}

/** `m:ss`, e.g. 905 -> "15:05", 59 -> "0:59". */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Placeholder names written before catalog/Steam resolution (e.g. `App 1010820`). */
export function isPlaceholderMarketName(name: string | null | undefined, appid: string): boolean {
  const n = String(name ?? '').trim();
  const id = String(appid ?? '').trim();
  if (!n) return true;
  if (id && n === `App ${id}`) return true;
  return /^App \d+$/.test(n);
}

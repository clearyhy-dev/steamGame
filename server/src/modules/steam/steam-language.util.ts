/**
 * Maps admin/app short language codes to Steam Store `l=` parameter values.
 * If already a long token (e.g. schinese), returns as-is.
 */
export function mapToSteamAppDetailsLang(lang: string | undefined): string {
  const raw = String(lang ?? '').trim().toLowerCase();
  if (!raw) return 'english';
  if (raw.length > 4 || raw.includes('chinese') || raw === 'schinese' || raw === 'tchinese') {
    return raw;
  }
  const map: Record<string, string> = {
    en: 'english',
    ja: 'japanese',
    zh: 'schinese',
    'zh-cn': 'schinese',
    'zh-hans': 'schinese',
    'zh-tw': 'tchinese',
    'zh-hk': 'tchinese',
    ko: 'koreana',
    fr: 'french',
    de: 'german',
    es: 'spanish',
    pt: 'portuguese',
    ru: 'russian',
    pl: 'polish',
    it: 'italian',
    nl: 'dutch',
    tr: 'turkish',
    th: 'thai',
    vi: 'vietnamese',
    ar: 'arabic',
    id: 'indonesian',
    sv: 'swedish',
    no: 'norwegian',
    nb: 'norwegian',
    nn: 'norwegian',
    da: 'danish',
    fi: 'finnish',
    cs: 'czech',
    hu: 'hungarian',
    ro: 'romanian',
    he: 'hebrew',
    el: 'greek',
    uk: 'ukrainian',
    hi: 'hindi',
    bg: 'bulgarian',
    hr: 'croatian',
    sr: 'serbian',
    sl: 'slovenian',
    sk: 'slovak',
    et: 'estonian',
    lv: 'latvian',
    lt: 'lithuanian',
    bs: 'bosnian',
    ms: 'malay',
  };
  return map[raw] ?? 'english';
}

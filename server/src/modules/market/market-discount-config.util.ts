import type {
  AdminSettingsRepository,
  DiscountProvidersConfig,
} from '../admin/admin.settings.repository';

export function trimDiscountProviderKeys(cfg: DiscountProvidersConfig): DiscountProvidersConfig {
  return {
    ...cfg,
    itadApiKey: String(cfg.itadApiKey ?? '').trim(),
    ggDealsApiKey: String(cfg.ggDealsApiKey ?? '').trim(),
    steamApiKey: String(cfg.steamApiKey ?? '').trim(),
  };
}

export function discountKeysReady(cfg: DiscountProvidersConfig): boolean {
  const t = trimDiscountProviderKeys(cfg);
  return t.itadApiKey.length > 0 && t.ggDealsApiKey.length > 0;
}

/** 市场刷价必须配置 ITAD + GG；返回 trim 后的配置供下游 API 调用 */
export async function resolveDiscountCfgForPriceSync(
  preloaded: DiscountProvidersConfig | undefined,
  repo: AdminSettingsRepository,
): Promise<DiscountProvidersConfig> {
  const cfg = trimDiscountProviderKeys(preloaded ?? (await repo.getDiscountProviders()));
  if (!discountKeysReady(cfg)) {
    throw new Error(
      'ITAD/GG API keys missing for market price sync. Configure Admin → Settings → Discount Providers.',
    );
  }
  return cfg;
}

export function bucketHasMissingApiKeyError(bucket: unknown): boolean {
  if (!bucket || typeof bucket !== 'object') return false;
  const b = bucket as Record<string, { error?: string } | undefined>;
  for (const src of ['isthereanydeal', 'ggdeals'] as const) {
    if (b[src]?.error === 'missing_api_key') return true;
  }
  return false;
}

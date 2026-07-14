import type { Env } from '../../config/env';
import { FavoritesRepository } from '../favorites/favorites.repository';
import { UsersRepository } from '../users/users.repository';
import { sqliteGetMarketGame } from '../../storage/sqlite/market-games.store';
import { useSqliteRelationalStore } from '../../config/database';
import { logger } from '../../utils/logger';
import { SmtpMailService } from './smtp-mail.service';
import { renderWishlistPriceAlertEmail } from './wishlist-price-alert.template';
import {
  currentLowestFromSummary,
  platformCellsFromSummary,
} from '../favorites/favorites-baseline.service';
import { userIsPro } from '../favorites/favorites.types';

const ALERT_COOLDOWN_MS = 24 * 3600_000;

export type WishlistPriceAlertRunResult = {
  usersScanned: number;
  emailsSent: number;
  alertsSkipped: number;
  errors: number;
};

export class WishlistPriceAlertService {
  private favorites = new FavoritesRepository();
  private users = new UsersRepository();
  private mail: SmtpMailService;

  constructor(private env: Env) {
    this.mail = new SmtpMailService(env);
  }

  async runProAlerts(): Promise<WishlistPriceAlertRunResult> {
    const out: WishlistPriceAlertRunResult = {
      usersScanned: 0,
      emailsSent: 0,
      alertsSkipped: 0,
      errors: 0,
    };

    if (!this.mail.isConfigured()) {
      logger.warn('[wishlist-email] SMTP not configured, skipping');
      return out;
    }
    if (!useSqliteRelationalStore()) {
      logger.warn('[wishlist-email] requires vultr_sqlite market data');
      return out;
    }

    const rows = await this.favorites.listAllWithUserId(8000);
    const byUser = new Map<string, typeof rows>();
    for (const row of rows) {
      const uid = String(row.userId ?? '').trim();
      if (!uid) continue;
      const list = byUser.get(uid) ?? [];
      list.push(row);
      byUser.set(uid, list);
    }

    for (const [userId, favs] of byUser) {
      out.usersScanned += 1;
      try {
        const user = await this.users.findById(userId);
        if (!userIsPro(user)) {
          out.alertsSkipped += favs.length;
          continue;
        }
        const email = String(user?.email ?? '').trim();
        if (!email) {
          out.alertsSkipped += favs.length;
          continue;
        }

        const cc = String(user?.countryCode ?? 'US').trim().toUpperCase();
        const alertItems = [];
        const nowIso = new Date().toISOString();
        const nowMs = Date.now();

        for (const fav of favs) {
          if (fav.emailAlertsEnabled === false) {
            out.alertsSkipped += 1;
            continue;
          }
          const baseline = fav.baselinePrices;
          if (!baseline || baseline.lowestFinalPrice == null) {
            out.alertsSkipped += 1;
            continue;
          }
          if (fav.lastEmailAlertAt) {
            const lastMs = Date.parse(fav.lastEmailAlertAt);
            if (Number.isFinite(lastMs) && nowMs - lastMs < ALERT_COOLDOWN_MS) {
              out.alertsSkipped += 1;
              continue;
            }
          }

          const market = await sqliteGetMarketGame(cc, fav.appid);
          if (!market?.priceSummary) {
            out.alertsSkipped += 1;
            continue;
          }
          const current = currentLowestFromSummary(market.priceSummary);
          if (!current || current.price >= baseline.lowestFinalPrice) {
            out.alertsSkipped += 1;
            continue;
          }

          const savingsPercent =
            baseline.lowestFinalPrice > 0
              ? Math.round(((baseline.lowestFinalPrice - current.price) / baseline.lowestFinalPrice) * 100)
              : 0;

          alertItems.push({
            fav,
            item: {
              appName: market.name || fav.name || fav.appid,
              appid: fav.appid,
              headerImage: fav.headerImage,
              baselineLowest: baseline.lowestFinalPrice,
              baselineCurrency: baseline.lowestCurrency,
              currentLowest: current.price,
              currentCurrency: current.currency,
              savingsPercent,
              platforms: platformCellsFromSummary(market.priceSummary),
            },
          });
        }

        if (alertItems.length === 0) continue;

        const appIconUrl = `${this.env.appBaseUrl.replace(/\/+$/, '')}/admin/icon.png`;
        const { subject, html, text } = renderWishlistPriceAlertEmail({
          appDisplayName: 'Steam Game Deals',
          appIconUrl,
          appBaseUrl: this.env.appBaseUrl,
          deeplinkScheme: this.env.appDeeplinkScheme,
          recipientName: user?.displayName ?? user?.steamPersonaName ?? '',
          countryCode: cc,
          items: alertItems.map((x) => x.item),
        });

        await this.mail.send({ to: email, subject, html, text });
        out.emailsSent += 1;

        for (const { fav } of alertItems) {
          await this.favorites.updateFavoriteFields(userId, fav.appid, { lastEmailAlertAt: nowIso });
        }
      } catch (e) {
        out.errors += 1;
        logger.warn(`[wishlist-email] user=${userId} err=${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return out;
  }
}

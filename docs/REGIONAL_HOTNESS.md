# Regional hot games (market v2)

## Before (global list)

Market round-robin used **`game_catalog.currentPlayers`** (global CCU) for every country — US, PL, CN, etc. shared the same Top 200 appids.

## Now (per-country Steam topsellers)

Each country loads its own list from the Steam Store search API:

- Endpoint: `GET store.steampowered.com/search/results/?filter=topsellers&cc={steamCc}&l={lang}&infinite=1`
- Pagination: `start` + `count` (50 per page) up to Top N (default 200)
- Order: **regional bestseller rank** (highest first)
- Implementation: `server/src/modules/steam/steam-regional-topsellers.ts`
- Cursor state: `market_sync_global_state.country_hot_appids_json` (per country, cleared when advancing to next country)

`market_games.heat_score` uses regional rank during sync so Admin **热度** sort matches the Steam chart order.

## Notes

- This is **store regional popularity**, not per-country concurrent players (Steam does not expose regional CCU publicly).
- Games outside the regional Top N are not updated in the current pass.
- After deploying, use `-ResetQueue` on a full resync to rebuild all countries with the new lists.

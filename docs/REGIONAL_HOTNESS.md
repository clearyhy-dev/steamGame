# Regional “hotness” vs global CCU

The app’s **「最多人在玩」 / most played** blocks use Steam **global** concurrent player counts (see `SteamApiService.fetchTopGamesByCurrentPlayers`). Steam’s public charts API does not expose per-country CCU in the same way; true **region-scoped popularity** would require:

- Partner/API access to regional charts, or
- Backend aggregation of opens/purchases by `countryCode`, or
- Heuristics (e.g. weight global CCU by regional deal velocity).

Treat this as **Phase 2** if product requirements demand strict per-country “hot” rankings beyond the current global signal.

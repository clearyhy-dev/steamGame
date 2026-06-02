#!/usr/bin/env python3
"""Migrate Firestore config collections to Vultr SQLite via REST (no gRPC).

Usage:
  set FIRESTORE_ACCESS_TOKEN=<gcloud auth print-access-token>
  set SQLITE_API_URL=http://139.180.199.42:8090
  set SQLITE_API_SECRET=...
  py server/scripts/migrate-config-rest.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any

PROJECT = os.environ.get("FIREBASE_PROJECT_ID", "steamdeal").strip()
API_BASE = os.environ.get("SQLITE_API_URL", "http://139.180.199.42:8090").rstrip("/")
API_SECRET = os.environ.get("SQLITE_API_SECRET", "steamgame-data-api-secret-change-me").strip()
FS_ROOT = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"


def access_token() -> str:
    tok = os.environ.get("FIRESTORE_ACCESS_TOKEN", "").strip()
    if tok:
        return tok
    out = subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
    return out


def parse_value(v: dict[str, Any]) -> Any:
    if "nullValue" in v:
        return None
    if "booleanValue" in v:
        return v["booleanValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "stringValue" in v:
        return v["stringValue"]
    if "timestampValue" in v:
        # ISO8601 e.g. 2026-03-28T04:51:49.483998Z
        from datetime import datetime

        s = v["timestampValue"].replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return {"_firestore_timestamp": True, "seconds": int(dt.timestamp())}
    if "arrayValue" in v:
        vals = v["arrayValue"].get("values") or []
        return [parse_value(x) for x in vals]
    if "mapValue" in v:
        fields = v["mapValue"].get("fields") or {}
        return {k: parse_value(fv) for k, fv in fields.items()}
    return None


def doc_fields(doc: dict[str, Any]) -> dict[str, Any]:
    fields = doc.get("fields") or {}
    return {k: parse_value(v) for k, v in fields.items()}


def doc_id(doc: dict[str, Any]) -> str:
    name = doc.get("name", "")
    return name.rsplit("/", 1)[-1]


def ts_ms(val: Any) -> int | None:
    if not isinstance(val, dict):
        return None
    if val.get("_firestore_timestamp") and isinstance(val.get("seconds"), int):
        return val["seconds"] * 1000
    return None


def fs_get(path: str, token: str) -> dict[str, Any] | None:
    req = urllib.request.Request(f"{FS_ROOT}/{path}", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def fs_list(collection: str, token: str, page_size: int = 300) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    page_token = ""
    while True:
        url = f"{FS_ROOT}/{collection}?pageSize={page_size}"
        if page_token:
            url += f"&pageToken={page_token}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
        docs.extend(data.get("documents") or [])
        page_token = data.get("nextPageToken") or ""
        print(f"[firestore] {collection} fetched {len(docs)}")
        if not page_token:
            break
    return docs


def sql_run(sql: str, params: list[Any], label: str = "") -> None:
    body = json.dumps({"sql": sql, "params": params, "mode": "run"}).encode()
    headers = {"Content-Type": "application/json", "X-Data-Api-Secret": API_SECRET}
    req = urllib.request.Request(f"{API_BASE}/v1/sql", data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            out = json.loads(resp.read().decode())
            if not out.get("ok"):
                raise RuntimeError(out)
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise RuntimeError(f"{label}: {err}") from e


def main() -> int:
    token = access_token()
    import time

    now = int(time.time() * 1000)

    # users
    for doc in fs_list("users", token):
        d = doc_fields(doc)
        i = doc_id(doc)
        sql_run(
            """INSERT INTO users (
              id, email, password_hash, display_name, avatar_url, auth_providers_json, admin_note, disabled,
              steam_id, steam_persona_name, steam_avatar, steam_profile_url, registered_at_ms, created_at_ms, updated_at_ms
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET email=excluded.email, updated_at_ms=excluded.updated_at_ms""",
            [
                i,
                d.get("email"),
                d.get("passwordHash"),
                d.get("displayName"),
                d.get("avatarUrl"),
                json.dumps(d.get("authProviders") or []),
                d.get("adminNote"),
                1 if d.get("disabled") else 0,
                d.get("steamId"),
                d.get("steamPersonaName"),
                d.get("steamAvatar"),
                d.get("steamProfileUrl"),
                ts_ms(d.get("registeredAt")),
                ts_ms(d.get("createdAt")) or now,
                ts_ms(d.get("updatedAt")) or now,
            ],
        )
    print("[migrate] users ok")

    # region
    for doc in fs_list("region_country_configs", token):
        d = doc_fields(doc)
        i = doc_id(doc)
        sql_run(
            """INSERT INTO region_country_configs (
              country_code, country_name, native_name, steam_cc, itad_country, gg_deals_region, cheapshark_country,
              default_currency, currency_symbol, steam_language, ui_language, enabled, sort_order, created_at_ms, updated_at_ms
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(country_code) DO UPDATE SET country_name=excluded.country_name, updated_at_ms=excluded.updated_at_ms""",
            [
                i,
                d.get("countryName") or i,
                d.get("nativeName") or "",
                d.get("steamCc") or i,
                d.get("itadCountry") or "",
                d.get("ggDealsRegion") or "",
                d.get("cheapsharkCountry") or "",
                d.get("defaultCurrency") or "USD",
                d.get("currencySymbol") or "$",
                d.get("steamLanguage") or "english",
                d.get("uiLanguage") or "en",
                0 if d.get("enabled") is False else 1,
                d.get("sortOrder") or 0,
                ts_ms(d.get("createdAt")) or now,
                ts_ms(d.get("updatedAt")) or now,
            ],
            label=f"region/{i}",
        )
    print("[migrate] region_country_configs ok")

    # discount_providers
    doc = fs_get("system_config/discount_providers", token)
    if doc:
        d = doc_fields(doc)
        sql_run(
            """INSERT INTO config_discount_providers (
              id, itad_api_key, gg_deals_api_key, steam_api_key, itad_base_url, gg_deals_base_url, cheap_shark_base_url,
              steam_web_api_base_url, steam_store_base_url, created_at_ms, updated_at_ms
            ) VALUES (1,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET steam_api_key=excluded.steam_api_key, updated_at_ms=excluded.updated_at_ms""",
            [
                d.get("itadApiKey") or "",
                d.get("ggDealsApiKey") or "",
                d.get("steamApiKey") or "",
                d.get("itadBaseUrl") or "",
                d.get("ggDealsBaseUrl") or "",
                d.get("cheapSharkBaseUrl") or "",
                d.get("steamWebApiBaseUrl") or "",
                d.get("steamStoreBaseUrl") or "",
                ts_ms(d.get("createdAt")) or now,
                ts_ms(d.get("updatedAt")) or now,
            ],
        )
        print("[migrate] discount_providers ok")

    # runtime
    doc = fs_get("system_config/runtime", token)
    if doc:
        d = doc_fields(doc)
        for key, val in d.items():
            if key in ("createdAt", "updatedAt") or val is None:
                continue
            sql_run(
                "INSERT INTO config_runtime (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [key, json.dumps(val) if isinstance(val, (dict, list)) else str(val)],
            )
        print("[migrate] runtime ok")

    # scheduled_tasks
    doc = fs_get("system_config/scheduled_tasks", token)
    if doc:
        d = doc_fields(doc)
        sql_run(
            "INSERT INTO scheduled_tasks_meta (id, created_at_ms, updated_at_ms) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET updated_at_ms=excluded.updated_at_ms",
            [ts_ms(d.get("createdAt")) or now, ts_ms(d.get("updatedAt")) or now],
        )
        for t in d.get("tasks") or []:
            sql_run(
                """INSERT INTO scheduled_tasks (
                  id, label, enabled, task_key, timezone, frequency, time_of_day, every_hours, payload_json,
                  last_run_at_ms, last_run_ok, last_run_summary, last_error
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET label=excluded.label, enabled=excluded.enabled, payload_json=excluded.payload_json""",
                [
                    t.get("id"),
                    t.get("label"),
                    0 if t.get("enabled") is False else 1,
                    t.get("taskKey"),
                    t.get("timezone"),
                    t.get("frequency"),
                    t.get("timeOfDay"),
                    t.get("everyHours"),
                    json.dumps(t.get("payload") or {}),
                    ts_ms(t.get("lastRunAt")),
                    (1 if t.get("lastRunOk") else 0) if isinstance(t.get("lastRunOk"), bool) else None,
                    t.get("lastRunSummary"),
                    t.get("lastError"),
                ],
            )
        print(f"[migrate] scheduled_tasks ok ({len(d.get('tasks') or [])} tasks)")

    steam_maps: list[tuple[str, str, str, Any]] = [
        (
            "steam_profiles",
            "steam_profiles",
            """INSERT INTO steam_profiles (
              steam_id, persona_name, real_name, avatar, avatar_full, profile_url, country_code,
              country_hydration_checked_at_ms, force_country_refresh_once, time_created, last_fetched_at_ms, linked_user_id
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(steam_id) DO UPDATE SET persona_name=excluded.persona_name""",
            lambda i, d: [
                i,
                d.get("personaName"),
                d.get("realName"),
                d.get("avatar"),
                d.get("avatarFull"),
                d.get("profileUrl"),
                d.get("countryCode"),
                ts_ms(d.get("countryHydrationCheckedAt")),
                1 if d.get("forceCountryRefreshOnce") else 0,
                d.get("timeCreated"),
                ts_ms(d.get("lastFetchedAt")),
                d.get("linkedUserId"),
            ],
        ),
        (
            "steam_friends_cache",
            "steam_friends_cache",
            "INSERT INTO steam_friends_cache (owner_steam_id, friends_json, last_fetched_at_ms) VALUES (?,?,?) ON CONFLICT(owner_steam_id) DO UPDATE SET friends_json=excluded.friends_json",
            lambda i, d: [i, json.dumps(d.get("friends") or []), ts_ms(d.get("lastFetchedAt")) or now],
        ),
        (
            "steam_games_owned_cache",
            "steam_owned_games_cache",
            "INSERT INTO steam_owned_games_cache (owner_steam_id, games_json, game_count, last_fetched_at_ms) VALUES (?,?,?,?) ON CONFLICT(owner_steam_id) DO UPDATE SET games_json=excluded.games_json",
            lambda i, d: [i, json.dumps(d.get("games") or []), d.get("gameCount") or 0, ts_ms(d.get("lastFetchedAt")) or now],
        ),
        (
            "steam_games_recent_cache",
            "steam_recent_games_cache",
            "INSERT INTO steam_recent_games_cache (owner_steam_id, games_json, total_count, last_fetched_at_ms) VALUES (?,?,?,?) ON CONFLICT(owner_steam_id) DO UPDATE SET games_json=excluded.games_json",
            lambda i, d: [i, json.dumps(d.get("games") or []), d.get("totalCount") or 0, ts_ms(d.get("lastFetchedAt")) or now],
        ),
    ]
    for fs_col, table, sql, params_fn in steam_maps:
        for doc in fs_list(fs_col, token):
            d = doc_fields(doc)
            sql_run(sql, params_fn(doc_id(doc), d))
        print(f"[migrate] {table} ok")

    print("[migrate-config-rest] done")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(e, file=sys.stderr)
        raise SystemExit(1)

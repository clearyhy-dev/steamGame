import axios from 'axios';
import type { AuthEnv } from './env';

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';

type OpenIdQuery = Record<string, string | string[] | undefined>;

export class SteamOpenIdService {
  buildLoginRedirectUrl(env: AuthEnv, returnTo: string): string {
    const query = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo,
      'openid.realm': env.steamOpenidRealm,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    }).toString();
    return `${STEAM_OPENID_ENDPOINT}?${query}`;
  }

  async verifyCallbackAndExtractSteamId(env: AuthEnv, openidQuery: OpenIdQuery): Promise<string> {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(openidQuery)) {
      if (!k.startsWith('openid.')) continue;
      if (typeof v === 'string') params[k] = v;
      else if (Array.isArray(v)) params[k] = v[0];
    }
    if (!params['openid.mode']) throw new Error('Missing openid.mode');
    params['openid.mode'] = 'check_authentication';
    const body = new URLSearchParams(params).toString();
    const resp = await axios.post(STEAM_OPENID_ENDPOINT, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: env.steamHttpTimeoutMs,
    });
    const text = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    if (!text.includes('is_valid:true')) throw new Error('Steam OpenID verification failed');
    const claimedId = params['openid.claimed_id'] ?? params['openid.identity'];
    const m = claimedId.match(/\/id\/(\d+)\b/);
    if (!m?.[1]) throw new Error('Cannot extract steamId');
    return m[1];
  }
}

import type { Env } from '../../config/env';
import { ApiError } from '../../utils/apiError';
import axios from 'axios';

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';

type OpenIdQuery = Record<string, string | string[] | undefined>;

export class SteamOpenIdService {
  private steamLoginEndpoint = STEAM_OPENID_ENDPOINT;

  buildLoginRedirectUrl(env: Env, returnTo: string): string {
    const realm = env.steamOpenidRealm;
    const query = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo,
      'openid.realm': realm,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    }).toString();

    return `${this.steamLoginEndpoint}?${query}`;
  }

  /**
   * Verify OpenID callback with Steam by calling check_authentication.
   * Returns steamId when valid.
   */
  async verifyCallbackAndExtractSteamId(env: Env, openidQuery: OpenIdQuery): Promise<string> {
    // Only send OpenID-related parameters to Steam verification.
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(openidQuery as OpenIdQuery)) {
      if (!k.startsWith('openid.')) continue;
      if (typeof v === 'string') params[k] = v;
      else if (Array.isArray(v)) params[k] = v[0];
    }

    if (!params['openid.mode']) throw new ApiError(400, 'BAD_REQUEST', 'Missing openid.mode');
    if (!params['openid.claimed_id'] && !params['openid.identity']) {
      throw new ApiError(400, 'BAD_REQUEST', 'Missing claimed_id/identity');
    }

    // Verification request:
    // - Set openid.mode=check_authentication
    // - Echo back all parameters
    params['openid.mode'] = 'check_authentication';

    const body = new URLSearchParams(params).toString();
    try {
      const resp = await axios.post(this.steamLoginEndpoint, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: env.steamHttpTimeoutMs,
      });
      const text = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      const isValid = text.includes('is_valid:true');
      if (!isValid) {
        throw new ApiError(401, 'STEAM_LOGIN_FAILED', 'Steam OpenID verification failed');
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(401, 'STEAM_LOGIN_FAILED', 'Steam OpenID verification request failed', e);
    }

    const claimedId = params['openid.claimed_id'] ?? params['openid.identity'];
    const steamId = this.extractSteamIdFromClaimed(claimedId);
    if (!steamId) throw new ApiError(401, 'STEAM_LOGIN_FAILED', 'Cannot extract steamId');
    return steamId;
  }

  private extractSteamIdFromClaimed(claimedId: string): string | null {
    // claimed_id looks like: https://steamcommunity.com/openid/id/<steamId>
    if (!claimedId) return null;
    const m = claimedId.match(/\/id\/(\d+)\b/);
    return m?.[1] ?? null;
  }
}


"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SteamOpenIdService = void 0;
const apiError_1 = require("../../utils/apiError");
const axios_1 = __importDefault(require("axios"));
const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
class SteamOpenIdService {
    env;
    steamLoginEndpoint = STEAM_OPENID_ENDPOINT;
    constructor(env) {
        this.env = env;
    }
    buildLoginRedirectUrl(returnTo) {
        const realm = this.env.steamOpenidRealm;
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
    async verifyCallbackAndExtractSteamId(openidQuery) {
        // Only send OpenID-related parameters to Steam verification.
        const params = {};
        for (const [k, v] of Object.entries(openidQuery)) {
            if (!k.startsWith('openid.'))
                continue;
            if (typeof v === 'string')
                params[k] = v;
            else if (Array.isArray(v))
                params[k] = v[0];
        }
        if (!params['openid.mode'])
            throw new apiError_1.ApiError(400, 'BAD_REQUEST', 'Missing openid.mode');
        if (!params['openid.claimed_id'] && !params['openid.identity']) {
            throw new apiError_1.ApiError(400, 'BAD_REQUEST', 'Missing claimed_id/identity');
        }
        // Verification request:
        // - Set openid.mode=check_authentication
        // - Echo back all parameters
        params['openid.mode'] = 'check_authentication';
        const body = new URLSearchParams(params).toString();
        try {
            const resp = await axios_1.default.post(this.steamLoginEndpoint, body, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: this.env.steamHttpTimeoutMs,
            });
            const text = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
            const isValid = text.includes('is_valid:true');
            if (!isValid) {
                throw new apiError_1.ApiError(401, 'STEAM_LOGIN_FAILED', 'Steam OpenID verification failed');
            }
        }
        catch (e) {
            if (e instanceof apiError_1.ApiError)
                throw e;
            throw new apiError_1.ApiError(401, 'STEAM_LOGIN_FAILED', 'Steam OpenID verification request failed', e);
        }
        const claimedId = params['openid.claimed_id'] ?? params['openid.identity'];
        const steamId = this.extractSteamIdFromClaimed(claimedId);
        if (!steamId)
            throw new apiError_1.ApiError(401, 'STEAM_LOGIN_FAILED', 'Cannot extract steamId');
        return steamId;
    }
    extractSteamIdFromClaimed(claimedId) {
        // claimed_id looks like: https://steamcommunity.com/openid/id/<steamId>
        if (!claimedId)
            return null;
        const m = claimedId.match(/\/id\/(\d+)\b/);
        return m?.[1] ?? null;
    }
}
exports.SteamOpenIdService = SteamOpenIdService;

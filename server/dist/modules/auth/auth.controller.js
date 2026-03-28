"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const apiError_1 = require("../../utils/apiError");
const steam_openid_service_1 = require("../steam/steam.openid.service");
const steam_service_1 = require("../steam/steam.service");
const auth_service_1 = require("./auth.service");
function deepLink(env, host, path, params) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${env.appDeeplinkScheme}://${host}${normalizedPath}`);
    for (const [k, v] of Object.entries(params))
        url.searchParams.set(k, v);
    return url.toString();
}
class AuthController {
    env;
    openid;
    steam;
    auth;
    constructor(env) {
        this.env = env;
        this.openid = new steam_openid_service_1.SteamOpenIdService(env);
        this.steam = new steam_service_1.SteamService(env);
        this.auth = new auth_service_1.AuthService(env);
    }
    startSteam = async (req, res) => {
        const modeRaw = String(req.query.mode ?? 'login').toLowerCase();
        const mode = modeRaw === 'bind' ? 'bind' : 'login';
        const returnUrl = new URL(this.env.steamOpenidReturnUrl);
        returnUrl.searchParams.set('mode', mode);
        if (mode === 'bind') {
            const appUserId = String(req.query.appUserId ?? '');
            const appEmail = String(req.query.appEmail ?? '');
            const appPhotoUrl = String(req.query.appPhotoUrl ?? '');
            if (!appUserId)
                throw new apiError_1.ApiError(400, 'BAD_REQUEST', 'Missing appUserId for bind mode');
            returnUrl.searchParams.set('appUserId', appUserId);
            if (appEmail)
                returnUrl.searchParams.set('appEmail', appEmail);
            if (appPhotoUrl)
                returnUrl.searchParams.set('appPhotoUrl', appPhotoUrl);
        }
        // Optional random state to avoid accidental mix-ups (kept as return_to param).
        returnUrl.searchParams.set('state', cryptoRandomState());
        const redirectUrl = this.openid.buildLoginRedirectUrl(returnUrl.toString());
        res.redirect(302, redirectUrl);
    };
    callbackSteam = async (req, res) => {
        try {
            const steamId = await this.openid.verifyCallbackAndExtractSteamId(req.query);
            const modeRaw = String(req.query.mode ?? 'login').toLowerCase();
            const mode = modeRaw === 'bind' ? 'bind' : 'login';
            const appUserId = mode === 'bind' ? String(req.query.appUserId ?? '') : undefined;
            const appEmail = mode === 'bind' ? String(req.query.appEmail ?? '') : undefined;
            const appPhotoUrl = mode === 'bind' ? String(req.query.appPhotoUrl ?? '') : undefined;
            const profiles = await this.steam.getPlayerSummaries([steamId]);
            const profile = profiles[0];
            if (!profile)
                throw new apiError_1.ApiError(401, 'STEAM_LOGIN_FAILED', 'Steam profile not found');
            if (!profile.personaName)
                throw new apiError_1.ApiError(401, 'STEAM_LOGIN_FAILED', 'Steam persona name missing');
            const result = await this.auth.loginOrBindSteam({
                mode,
                steamId,
                appUserId,
                appEmail,
                appPhotoUrl,
                steamProfile: profile,
            });
            res.redirect(302, deepLink(this.env, this.env.appDeeplinkSuccessHost, '/steam/success', {
                token: result.token,
            }));
        }
        catch (e) {
            const reason = e instanceof apiError_1.ApiError ? e.message : String(e?.message ?? e);
            res.redirect(302, deepLink(this.env, this.env.appDeeplinkFailHost, '/steam/fail', {
                reason,
            }));
        }
    };
    bindSteam = async (req, res) => {
        const userId = req.auth?.userId;
        if (!userId)
            throw new apiError_1.ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
        const steamId = String((req.body?.steamId ?? '').toString());
        if (!steamId)
            throw new apiError_1.ApiError(400, 'BAD_REQUEST', 'Missing steamId');
        const profiles = await this.steam.getPlayerSummaries([steamId]);
        const profile = profiles[0];
        if (!profile)
            throw new apiError_1.ApiError(401, 'STEAM_LOGIN_FAILED', 'Steam profile not found');
        const result = await this.auth.bindSteamToAuthenticatedUser({
            userId,
            steamId,
            steamProfile: profile,
        });
        res.json({ success: true, data: { token: result.token } });
    };
    logout = async (_req, res) => {
        // Stateless JWT: client should just drop token.
        res.json({ success: true, data: { ok: true } });
    };
}
exports.AuthController = AuthController;
function cryptoRandomState() {
    // eslint-disable-next-line no-undef
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

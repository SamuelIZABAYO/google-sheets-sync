import crypto from 'node:crypto';
import { env, getGoogleRedirectUri } from '../config/env.js';

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: 'Bearer';
  expires_in: number;
  id_token?: string;
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export class GoogleOAuthService {
  createState(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  buildAuthorizationUrl(state: string): string {
    const redirectUri = getGoogleRedirectUri();
    const scopes = env.GOOGLE_OAUTH_SCOPES.split(/\s+/).filter(Boolean).join(' ');

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true'
    });

    return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getGoogleRedirectUri(),
      grant_type: 'authorization_code'
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });

    if (!response.ok) {
      throw new Error(`Google token exchange failed with status ${response.status}`);
    }

    return (await response.json()) as GoogleTokenResponse;
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });

    if (!response.ok) {
      throw new Error(`Google token refresh failed with status ${response.status}`);
    }

    return (await response.json()) as GoogleTokenResponse;
  }

  async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Google user info fetch failed with status ${response.status}`);
    }

    const userInfo = (await response.json()) as GoogleUserInfo;

    if (!userInfo.sub || !userInfo.email) {
      throw new Error('Google user info missing required fields');
    }

    return userInfo;
  }
}

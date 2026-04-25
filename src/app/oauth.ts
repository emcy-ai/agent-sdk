import type {
  EmcyAgentConfig,
  McpServerAuthConfig,
  OAuthTokenResponse,
} from '../core/types';
import type {
  AppAgentPlatform,
  AppAgentUserIdentity,
} from './types';

function normalizeOptionalValue(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function isGatewayAuthorizeUrl(authorizationEndpoint: string): boolean {
  try {
    const url = new URL(authorizationEndpoint);
    return /\/api\/v1\/gateway\/[^/]+\/authorize$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function randomToken(length: number): Promise<string> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

export function createPlatformAuthHandler(options: {
  platform: AppAgentPlatform;
  userIdentity?: AppAgentUserIdentity;
  oauthCallbackUrl: string;
}): EmcyAgentConfig['onAuthRequired'] {
  return async (_mcpServerUrl: string, authConfig: McpServerAuthConfig): Promise<OAuthTokenResponse | undefined> => {
    if (!options.platform.auth) {
      return undefined;
    }

    const authorizationEndpoint = authConfig.authorizationEndpoint ?? authConfig.loginUrl;
    const tokenEndpoint = authConfig.tokenEndpoint ?? authConfig.tokenUrl;
    const clientId = authConfig.clientId;
    const redirectUri = authConfig.callbackUrl ?? options.oauthCallbackUrl;

    if (!authorizationEndpoint || !tokenEndpoint || !clientId || !redirectUri) {
      return undefined;
    }

    const verifier = await randomToken(48);
    const state = await randomToken(24);
    const challenge = await createCodeChallenge(verifier);
    const authorizeUrl = new URL(authorizationEndpoint);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    if (authConfig.scopes?.length) {
      authorizeUrl.searchParams.set('scope', authConfig.scopes.join(' '));
    }

    if (authConfig.resource) {
      authorizeUrl.searchParams.set('resource', authConfig.resource);
    }

    if (options.userIdentity && isGatewayAuthorizeUrl(authorizationEndpoint)) {
      const subject = normalizeOptionalValue(options.userIdentity.subject);
      const email = normalizeOptionalValue(options.userIdentity.email);
      const organizationId = normalizeOptionalValue(options.userIdentity.organizationId);
      const displayName = normalizeOptionalValue(options.userIdentity.displayName);

      if (subject) {
        authorizeUrl.searchParams.set('emcy_host_subject', subject);
      }
      if (email) {
        authorizeUrl.searchParams.set('emcy_host_email', email);
      }
      if (organizationId) {
        authorizeUrl.searchParams.set('emcy_host_organization_id', organizationId);
      }
      if (displayName) {
        authorizeUrl.searchParams.set('emcy_host_display_name', displayName);
      }
      authorizeUrl.searchParams.set('emcy_mismatch_policy', 'block_with_switch');
    }

    const result = await options.platform.auth.openOAuthSession({
      authorizeUrl: authorizeUrl.toString(),
      redirectUri,
      preferEphemeralSession: true,
    });

    if (result.type !== 'success' || !result.url) {
      return undefined;
    }

    const callback = new URL(result.url);
    const returnedState = callback.searchParams.get('state');
    const code = callback.searchParams.get('code');
    if (returnedState !== state || !code) {
      const errorDescription = callback.searchParams.get('error_description');
      const errorCode = callback.searchParams.get('error');
      throw new Error(errorDescription ?? (errorCode ? `OAuth error: ${errorCode}` : 'Could not complete OAuth login.'));
    }

    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
        ...(authConfig.resource ? { resource: authConfig.resource } : {}),
      }).toString(),
    });

    const payload = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok) {
      throw new Error(
        (payload as { error_description?: string; error?: string } | null)?.error_description
          ?? (payload as { error?: string } | null)?.error
          ?? `OAuth sign in failed (${tokenResponse.status}).`,
      );
    }

    return {
      accessToken: payload?.access_token ?? payload?.accessToken,
      refreshToken: payload?.refresh_token ?? payload?.refreshToken,
      expiresIn: payload?.expires_in ?? payload?.expiresIn,
      tokenType: payload?.token_type ?? payload?.tokenType,
      resolvedAuthConfig: { ...authConfig, callbackUrl: redirectUri },
    };
  };
}

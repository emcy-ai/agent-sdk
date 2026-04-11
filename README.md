# @emcy/agent-sdk

Embeddable AI chat widget powered by MCP.

The SDK is designed so embedded apps do not need to host OAuth callback routes, client metadata routes, or manage MCP tokens directly. Emcy owns the popup OAuth helper surface and brokers downstream grants server-side.

## Installation

```bash
npm install @emcy/agent-sdk
```

## Quick Start

### React

```tsx
import { EmcyChat } from "@emcy/agent-sdk/react";

function App() {
  return (
    <div style={{ height: 640 }}>
      <EmcyChat
        apiKey="emcy_sk_xxxx"
        agentId="ag_xxxxx"
        authSessionKey={currentSession.id}
        mode="inline"
        title="AI Assistant"
        embeddedAuth={{
          hostIdentity: {
            subject: currentUser.id,
            email: currentUser.email,
            organizationId: currentUser.organizationId,
            displayName: currentUser.name,
            avatarUrl: currentUser.avatarUrl,
          },
          mismatchPolicy: "block_with_switch",
        }}
      />
    </div>
  );
}
```

### Vanilla JS / TypeScript

```ts
import { EmcyAgent } from "@emcy/agent-sdk";

const agent = new EmcyAgent({
  apiKey: "emcy_sk_xxxx",
  agentId: "ag_xxxxx",
  authSessionKey: currentSession.id,
  embeddedAuth: {
    hostIdentity: {
      subject: currentUser.id,
      email: currentUser.email,
    },
    mismatchPolicy: "block_with_switch",
  },
});

await agent.init();
```

## Configuration

| Option | Type | Description |
| ------ | ---- | ----------- |
| `apiKey` | `string` | Emcy API key |
| `agentId` | `string` | Agent or agent ID |
| `agentServiceUrl` | `string` | Emcy API URL. Defaults to `https://api.emcy.ai`. |
| `oauthCallbackUrl` | `string` | Override Emcy's popup callback URL. Defaults to Emcy's hosted helper route, or `http://localhost:3100/oauth/callback` when running locally. |
| `oauthClientMetadataUrl` | `string` | Override Emcy's popup client metadata URL. Defaults to Emcy's hosted helper route, or `http://localhost:3100/.well-known/oauth-client-metadata.json` when running locally. |
| `authSessionKey` | `string \| null` | Host app auth-session boundary for persisted MCP auth. Pass your current session id so logout forces reconnect, even for the same user. |
| `embeddedAuth` | `EmcyEmbeddedAuthConfig` | Host-account hints for embedded popup auth. This is how the host app tells Emcy who the current user is without passing tokens. |
| `onAuthRequired` | `(mcpServerUrl: string, authConfig: McpServerAuthConfig) => Promise<OAuthTokenResponse \| undefined>` | Advanced override for the built-in popup auth flow. |
| `useCookies` | `boolean` | Send cookies with MCP requests. Defaults to `false`. |
| `externalUserId` | `string` | Optional user identifier for conversations. |
| `context` | `Record<string, unknown>` | Extra context sent with each message. |

When present, `externalUserId` and `embeddedAuth.hostIdentity` are combined into a typed `externalUser` payload on chat requests so Emcy agents can attribute usage and budgets per embedded end user.

## Embedded Auth

Embedded MCP auth is popup-only.

The recommended flow is:

1. your app passes the current host identity through `embeddedAuth`
2. the widget shows `Start AI` / `Start AI with your account`
3. Emcy attempts same-account popup auth first
4. if a downstream session already exists for that user, the popup can complete immediately
5. if interactive login is needed, the popup stays on Emcy-owned helper routes and downstream provider pages
6. if the downstream provider resolves a different user, Emcy blocks the mismatch and asks the user to confirm switching accounts

Important behavior:

- the host app does not receive MCP access tokens
- consumer apps do not need to host OAuth callback routes
- consumer apps do not need to host OAuth client metadata routes
- the popup flow survives normal React rerenders
- the embedded flow can use the same downstream OAuth structure as the Emcy agent product

### `embeddedAuth`

```ts
type EmcyEmbeddedAuthIdentity = {
  subject?: string;
  email?: string;
  organizationId?: string;
  displayName?: string;
  avatarUrl?: string;
};

type EmcyEmbeddedAuthConfig = {
  hostIdentity?: EmcyEmbeddedAuthIdentity;
  mismatchPolicy: "block_with_switch";
};
```

Use `subject` when you have a stable app-specific user id. If not, `email` is the next best hint. If both the host app and downstream provider expose organization ids, include `organizationId` so Emcy can reject cross-org mismatches.

## Logout Cleanup

When your app signs the host user out, clear persisted MCP auth state too:

```ts
import { clearPersistedMcpAuth } from "@emcy/agent-sdk";

clearPersistedMcpAuth();
```

Use `authSessionKey` on every mounted SDK surface and call `clearPersistedMcpAuth()` during app logout so a later session cannot inherit cached MCP connections from the previous user.

## Standalone Popup Auth

If you do not pass `embeddedAuth`, the SDK still uses Emcy-owned popup OAuth for MCP servers that require auth. That keeps the hosted agent flow and public-client embed flow on the same standards-based path.

If you need to fully replace the built-in popup controller, provide `onAuthRequired`.

## React Components

- `EmcyChat` is the drop-in widget.
- `EmcyChatProvider` + `useEmcyChatContext` let you build custom UIs.
- `useEmcyAgent` exposes the lower-level agent hook.

## Localhost Helpers

When `agentServiceUrl` points at localhost, the SDK defaults popup helper URLs to:

- `http://localhost:3100/oauth/callback`
- `http://localhost:3100/.well-known/oauth-client-metadata.json`

That keeps local consumer apps clean while still exercising the real popup OAuth flow.

## License

MIT

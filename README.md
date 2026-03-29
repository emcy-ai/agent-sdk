# @emcy/agent-sdk

Embeddable AI chat widget powered by MCP. Add an LLM-powered agent to your web app in minutes.

Part of the [Emcy](https://emcy.ai) ecosystem — open source under MIT.

v.0.1.0

---

## Features

- **Drop-in chat widget** — Floating or inline, ready to use
- **MCP-powered** — Tools run via your MCP server; user auth flows browser → MCP, never through Emcy
- **Streaming** — Real-time token streaming with thinking indicators
- **Framework-agnostic core** — `EmcyAgent` works in any JS environment
- **React components** — Pre-built UI or custom composition with `useEmcyAgent` hook

---

## Installation

```bash
npm install @emcy/agent-sdk
```

You need an API key and agent ID from the [Emcy dashboard](https://emcy.ai).

---

## Quick start

### React

```tsx
import { EmcyChat } from "@emcy/agent-sdk/react";

function App() {
  return (
    <EmcyChat
      apiKey="emcy_sk_xxxx"
      agentId="agent_xxxxx"
      getToken={async () => session?.accessToken}
      title="AI Assistant"
      mode="floating"
    />
  );
}
```

### Vanilla JS / TypeScript

```ts
import { EmcyAgent } from "@emcy/agent-sdk";

const agent = new EmcyAgent({
  apiKey: "emcy_sk_xxxx",
  agentId: "agent_xxxxx",
  getToken: async () => getAuthToken(),
});

await agent.init();

agent.on("message", (msg) => console.log(msg));
agent.on("content_delta", (delta) => console.log(delta.text));
agent.on("error", (err) => console.error(err));

await agent.sendMessage("Hello!");
```

---

## Configuration

| Option            | Type                                 | Description                                       |
| ----------------- | ------------------------------------ | ------------------------------------------------- |
| `apiKey`          | `string`                             | Emcy API key                                      |
| `agentId`         | `string`                             | Agent ID from dashboard                           |
| `agentServiceUrl` | `string`                             | Emcy API URL (default: `https://api.emcy.ai`)     |
| `getToken`        | `(mcpServerUrl?: string) => Promise<OAuthTokenResponse \| string \| undefined>` | User auth token for MCP tool calls. See [Authentication](#authentication). |
| `useCookies`      | `boolean`                            | Send cookies with MCP requests (default: `false`) |
| `externalUserId`  | `string`                             | Optional user ID for conversations                |
| `context`         | `Record<string, unknown>`            | Extra context sent with each message              |

---

## Authentication

The SDK supports two authentication modes for MCP server calls:

### Embedded mode (`getToken`)

Use this when your app already has a user session. The SDK calls your `getToken` function **every time** it needs a token — no caching, no refresh logic. Your app is responsible for session management.

```tsx
<EmcyChat
  apiKey="..."
  agentId="..."
  getToken={async (mcpServerUrl) => {
    // Return token from your session
    // Called every time a token is needed
    return session?.accessToken;
  }}
/>
```

The `mcpServerUrl` parameter lets you return different tokens for different MCP servers in the same workspace.

**Key behavior:**
- `getToken` is called on every tool execution
- No SDK-side token caching — your app manages refresh
- Return a string (access token) or `{ accessToken, refreshToken?, expiresIn? }`
- On 401, the SDK calls `getToken` again for a fresh token
- Clicking `Sign Out` on a connected MCP server disconnects that server inside the SDK until the user explicitly reconnects it

### Standalone mode (OAuth popup)

When `getToken` is not provided, the SDK handles auth via built-in OAuth popup. Clicking "Needs Auth" on an MCP server opens the OAuth flow automatically. The SDK stores tokens with expiry and handles refresh.

**Key behavior:**
- SDK stores tokens in memory and localStorage
- Checks token expiry before each use
- Automatically refreshes using `refreshToken` if expired
- Opens OAuth popup when no valid token exists
- Clicking `Sign Out` clears the cached OAuth token and resets the MCP session

### Multiple MCP servers

Both modes support multiple MCP servers per workspace. The `mcpServerUrl` parameter identifies which server needs authentication, allowing you to return different tokens per server.

---

## React API

### `<EmcyChat />`

Drop-in widget with two visual modes:

#### 1. Floating popup (default)

Chatbot button in the corner; opens as an overlay. Best for support widgets on customer sites.

```tsx
<EmcyChat
  apiKey="..."
  agentId="..."
  mode="floating"
  title="AI Assistant"
  defaultOpen={false}
/>
```

#### 2. Inline embedded

Responsive full-window chat that fills its container. Use in dashboards, sidebars, or any layout. **Parent must have defined dimensions** (e.g. `height: 400px`, `flex: 1`, or `height: 100%`).

```tsx
<div style={{ height: '500px' }}>
  <EmcyChat
    apiKey="..."
    agentId="..."
    mode="inline"
    title="Support Chat"
  />
</div>
```

Or in a flex layout:

```tsx
<div className="flex flex-col h-[calc(100vh-200px)]">
  <div className="flex-1 min-h-0">
    <EmcyChat mode="inline" apiKey="..." agentId="..." />
  </div>
</div>
```

| Prop            | Type                | Description                                                       |
| --------------- | ------------------- | ----------------------------------------------------------------- |
| `mode`          | `'floating' \| 'inline'` | `floating` = popup overlay, `inline` = fill container (default: `floating`) |
| `title`         | `string`            | Chat window title                                                 |
| `welcomeMessage`| `string`            | Shown when no messages exist                                      |
| `placeholder`   | `string`            | Input placeholder                                                 |
| `defaultOpen`   | `boolean`           | Start open (floating mode only, default: `false`)                 |

### `useEmcyAgent(config)`

Hook for custom UI. Returns `messages`, `streamingContent`, `isLoading`, `isThinking`, `sendMessage`, `signOutMcpServer`, `newConversation`, `cancel`, etc.

### `EmcyChatProvider` + `useEmcyChatContext`

Compose your own chat UI with shared context.

---

## Emcy ecosystem

- **[emcy.ai](https://emcy.ai)** — Create and manage agents, configure MCP tools
- **@emcy/agent-sdk** — This package — embed agents in your app

---

## License

MIT

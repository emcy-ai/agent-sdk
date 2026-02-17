# @emcy/agent-sdk

Embeddable AI chat widget powered by MCP. Add an LLM-powered agent to your web app in minutes.

Part of the [Emcy](https://emcy.ai) ecosystem — open source under MIT.

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
| `getToken`        | `() => Promise<string \| undefined>` | User auth token for MCP tool calls                |
| `useCookies`      | `boolean`                            | Send cookies with MCP requests (default: `false`) |
| `externalUserId`  | `string`                             | Optional user ID for conversations                |
| `context`         | `Record<string, unknown>`            | Extra context sent with each message              |

---

## React API

### `<EmcyChat />`

Drop-in widget.

```tsx
<EmcyChat
  apiKey="..."
  agentId="..."
  mode="floating" | "inline"
  title="AI Assistant"
  welcomeMessage="How can I help?"
  placeholder="Type a message..."
  defaultOpen={false}
/>
```

### `useEmcyAgent(config)`

Hook for custom UI. Returns `messages`, `streamingContent`, `isLoading`, `isThinking`, `sendMessage`, `newConversation`, `cancel`, etc.

### `EmcyChatProvider` + `useEmcyChatContext`

Compose your own chat UI with shared context.

---

## Emcy ecosystem

- **[emcy.ai](https://emcy.ai)** — Create and manage agents, configure MCP tools
- **@emcy/agent-sdk** — This package — embed agents in your app

---

## License

MIT

# @emcy/agent-sdk

Use Emcy agents in your app.

This package gives you:

- a hosted agent runtime
- MCP-aware chat
- embedded OAuth for MCP servers
- a drop-in React UI
- lower-level hooks for custom web and native shells

## Install

```bash
npm install @emcy/agent-sdk
```

## Start Here

## The 2 Product Modes

### 1. Embed mode

Use this when you want the standard Emcy-style assistant in your app with minimal work.

Typical cases:

- support assistant
- ops assistant
- internal admin sidebar
- customer-facing in-app widget

Start with:

- `EmcyChat`
- or `EmcyChatProvider`

### 2. First-party app shell mode

Use this when the assistant is part of your product experience and should feel native to your app.

Typical cases:

- docked assistant in app chrome
- mobile bottom sheet assistant
- transcript + systems panels
- app-specific tool visibility
- custom workflow / approval UI

Start with:

- `@emcy/agent-sdk/react-native`
- `@emcy/agent-sdk/shell`
- or `useEmcyAgent` / `EmcyAgent` for custom web

## Fastest Example: Standard Web Embed

```tsx
import { EmcyChat } from "@emcy/agent-sdk/react";

export function App() {
  return (
    <div style={{ height: 640 }}>
      <EmcyChat
        apiKey="emcy_sk_xxxx"
        agentId="ag_xxxxx"
        authSessionKey={session.id}
        embeddedAuth={{
          hostIdentity: {
            subject: session.user.id,
            email: session.user.email,
            organizationId: session.organizationId,
          },
          mismatchPolicy: "block_with_switch",
        }}
      />
    </div>
  );
}
```

## Custom Web UI

```tsx
import { EmcyChatProvider, useEmcyChatContext } from "@emcy/agent-sdk/react";

function CustomAssistant() {
  const { messages, sendMessage, streamingContent, isLoading } =
    useEmcyChatContext();
  return null;
}

export function App() {
  return (
    <EmcyChatProvider
      apiKey="emcy_sk_xxxx"
      agentId="ag_xxxxx"
      authSessionKey={session.id}
    >
      <CustomAssistant />
    </EmcyChatProvider>
  );
}
```

## Custom React Native UI

```tsx
import { useEmcyAgentRuntime } from "@emcy/agent-sdk/react-native";
import { deriveToolMessages } from "@emcy/agent-sdk/shell";

export function AssistantShell() {
  const agent = useEmcyAgentRuntime({
    apiKey: "emcy_sk_xxxx",
    agentId: "ag_xxxxx",
    authSessionKey: session.id,
    embeddedAuth: {
      hostIdentity: {
        subject: session.user.id,
        email: session.user.email,
        organizationId: session.organizationId,
      },
      mismatchPolicy: "block_with_switch",
    },
    clientTools,
    context,
  });

  const toolMessages = deriveToolMessages(agent.messages);
  return null;
}
```

## Raw Runtime

```ts
import { EmcyAgent } from "@emcy/agent-sdk";

const agent = new EmcyAgent({
  apiKey: "emcy_sk_xxxx",
  agentId: "ag_xxxxx",
  authSessionKey: session.id,
});

await agent.init();
await agent.sendMessage("Hello");
```

## The 3 Config Options That Matter Most

### `apiKey`

Your Emcy API key.

### `agentId`

The agent to run.

### `authSessionKey`

Your app’s current signed-in session boundary.

Pass this so cached MCP auth does not leak across logout/login cycles.

## Embedded Auth

If an MCP server needs user-scoped OAuth, pass `embeddedAuth`.

```ts
embeddedAuth: {
  hostIdentity: {
    subject: session.user.id,
    email: session.user.email,
    organizationId: session.organizationId,
  },
  mismatchPolicy: "block_with_switch",
}
```

What this does:

- tells Emcy who your current signed-in app user is
- lets Emcy try same-user downstream auth
- blocks the wrong downstream account from silently connecting

Important:

- your app does **not** receive MCP access tokens
- Emcy owns the popup OAuth helper flow by default

## If You Want To Replace The Built-In Auth Popup

Use `onAuthRequired`.

That is an advanced override for custom auth UX.

Most apps should not need it.

## Localhost Defaults

When `agentServiceUrl` points to localhost, the SDK defaults popup helper URLs to:

- `http://localhost:3100/oauth/callback`
- `http://localhost:3100/.well-known/oauth-client-metadata.json`

That keeps local app setup simpler.

## Package Exports

### `@emcy/agent-sdk`

Core runtime:

- `EmcyAgent`
- auth helpers
- core types

### `@emcy/agent-sdk/react`

Web UI:

- `EmcyChat`
- `EmcyChatProvider`
- `useEmcyAgent`

### `@emcy/agent-sdk/react-native`

React Native custom-shell entrypoint:

- `useEmcyAgentRuntime`
- shell helpers re-exported for native use

### `@emcy/agent-sdk/shell`

Framework-agnostic helpers for custom agent shells:

- message grouping
- tool grouping
- pending-turn helpers
- status-label helpers
- payload formatting helpers

Use this when you want multiple apps to follow the same agent UX patterns without copying logic everywhere.

## In One Sentence

Use `EmcyChat` if you want the fastest integration. Use `react-native` and `shell` if you are building your own premium product-specific assistant.

## License

MIT

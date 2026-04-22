# @emcy/agent-sdk

Use Emcy agents in your app.

This package now has one public model for custom product integrations: `App Agent`.

## Install

```bash
npm install @emcy/agent-sdk
```

## Package surfaces

### `@emcy/agent-sdk`

Low-level runtime:

- `EmcyAgent`
- core auth helpers
- core transport and types

### `@emcy/agent-sdk/app`

Framework-agnostic agent experience helpers:

- `createAppAgent`
- `AppAgentController`
- message / tool derivation helpers
- resume / pending-turn / formatting helpers

### `@emcy/agent-sdk/react`

React app integration:

- `useAppAgent`
- `AppAgentProvider`
- `useAppAgentContext`

### `@emcy/agent-sdk/react-native`

React Native app integration:

- `useAppAgent`
- `AppAgentProvider`
- `useAppAgentContext`

### `@emcy/agent-sdk/react-embed`

Drop-in web widget:

- `EmcyChat`

## Start here

### 1. Drop-in web embed

```tsx
import { EmcyChat } from "@emcy/agent-sdk/react-embed";

export function App() {
  return (
    <div style={{ height: 640 }}>
      <EmcyChat
        apiKey="emcy_sk_xxxx"
        agentId="ag_xxxxx"
        appSessionKey={session.id}
        userIdentity={{
          subject: session.user.id,
          email: session.user.email,
          organizationId: session.organizationId,
        }}
        mode="inline"
        title="Support Agent"
      />
    </div>
  );
}
```

### 2. Custom React app UI

```tsx
import { useAppAgent } from "@emcy/agent-sdk/react";

export function CustomAssistant() {
  const agent = useAppAgent({
    apiKey: "emcy_sk_xxxx",
    agentId: "ag_xxxxx",
    appSessionKey: session.id,
    userIdentity: {
      subject: session.user.id,
      email: session.user.email,
      organizationId: session.organizationId,
    },
    hostActions,
    appContext,
  });

  return null;
}
```

### 3. Custom React Native UI

```tsx
import { useAppAgent } from "@emcy/agent-sdk/react-native";

export function AssistantShell() {
  const agent = useAppAgent({
    apiKey: "emcy_sk_xxxx",
    agentId: "ag_xxxxx",
    appSessionKey: session.id,
    userIdentity: {
      subject: session.user.id,
      email: session.user.email,
      organizationId: session.organizationId,
    },
    hostActions,
    appContext,
    platform,
  });

  const toolMessages = agent.conversation.toolMessages;
  return null;
}
```

### 4. Raw runtime

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

## Core app-agent config

### `apiKey`

Your Emcy API key.

### `agentId`

The agent to run.

### `appSessionKey`

Your host app’s current signed-in session boundary.

Pass this so persisted MCP auth and resumed conversations do not leak across logout/login cycles.

### `userIdentity`

The signed-in host user:

```ts
userIdentity: {
  subject: session.user.id,
  email: session.user.email,
  organizationId: session.organizationId,
}
```

### `hostActions`

App-owned functions the agent can call locally for UI work or host orchestration.

### `appContext`

Extra host context or policy instructions for the agent.

## OAuth

If an MCP server needs user-scoped OAuth:

- pass `userIdentity`
- let Emcy manage the popup flow by default
- override with `onAuthRequired` only when you need custom host auth UX

## Localhost defaults

When `serviceUrl` points to localhost, popup helper URLs default to:

- `http://localhost:3100/oauth/callback`
- `http://localhost:3100/.well-known/oauth-client-metadata.json`

## In one sentence

Use `react-embed` for the fastest hosted widget, and use `react` or `react-native` when the assistant is part of your product.

## License

MIT

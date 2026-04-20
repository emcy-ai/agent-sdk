import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../core/types";
import {
  buildRenderedNodes,
  createInlinePendingTurnState,
  deriveConversationMessages,
  deriveConversationStatusLabel,
  deriveInlineFeedState,
  deriveToolMessages,
  deriveToolStatusPresentation,
  formatStructuredText,
  getLatestAssistantMessage,
  summarizeConversationId,
} from "../presentation";

function createMessage(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage {
  return {
    timestamp: new Date("2026-04-19T00:00:00Z"),
    ...partial,
  };
}

describe("shell presentation helpers", () => {
  const messages: ChatMessage[] = [
    createMessage({ id: "u1", role: "user", content: "Get my checklists" }),
    createMessage({
      id: "t1",
      role: "tool_call",
      content: "Calling get_checklists...",
      toolCallId: "call-1",
      toolName: "get_checklists",
      toolCallStatus: "completed",
      toolCallDuration: 880,
    }),
    createMessage({
      id: "a1",
      role: "assistant",
      content: "Here are your checklists.",
    }),
  ];

  it("derives conversation and tool messages cleanly", () => {
    expect(deriveConversationMessages(messages).map((message) => message.id)).toEqual([
      "u1",
      "a1",
    ]);
    expect(deriveToolMessages(messages).map((message) => message.id)).toEqual(["t1"]);
    expect(getLatestAssistantMessage(messages)?.id).toBe("a1");
  });

  it("groups tool calls into rendered nodes", () => {
    expect(buildRenderedNodes(messages)).toEqual([
      { kind: "user", id: "u1", content: "Get my checklists" },
      {
        kind: "tools",
        id: "tools-a1",
        tools: [messages[1]],
      },
      { kind: "assistant", id: "a1", content: "Here are your checklists." },
    ]);
  });

  it("captures pending turn baselines and inline feed state", () => {
    const pendingTurn = createInlinePendingTurnState("Get my checklists", messages);
    const nextMessages = [
      ...messages,
      createMessage({
        id: "t2",
        role: "tool_call",
        content: "Calling get_assignments...",
        toolCallId: "call-2",
        toolName: "get_assignments",
        toolCallStatus: "calling",
      }),
    ];

    const feed = deriveInlineFeedState({
      pendingTurn,
      toolMessages: deriveToolMessages(nextMessages),
      latestAssistantContent: "Here are your checklists.",
      streamingContent: "",
      isLoading: true,
      isThinking: false,
    });

    expect(feed.pendingPrompt).toBe("Get my checklists");
    expect(feed.recentTools.map((message) => message.id)).toEqual(["t2"]);
    expect(feed.waitingForActivity).toBe(false);
    expect(feed.isActive).toBe(true);
  });

  it("formats status and payloads", () => {
    expect(deriveConversationStatusLabel({
      isReady: true,
      isLoading: false,
      isThinking: false,
      streamingContent: "",
    })).toBe("Ready");
    expect(deriveToolStatusPresentation("error")).toEqual({
      glyph: "✕",
      tone: "error",
      badgeLabel: "Failed",
    });
    expect(formatStructuredText('{"ok":true}')).toBe('{\n  "ok": true\n}');
    expect(summarizeConversationId("conv_1234567890")).toBe("conv_1…7890");
  });
});

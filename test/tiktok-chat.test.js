import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTikTokChatMessage } from "../src/tiktok-chat.js";

test("normalizes current TikTok chat message fields", () => {
  assert.deepEqual(normalizeTikTokChatMessage({
    content: "!entrar PlayerOne",
    user: {
      id: "12345",
      nickname: "Live nickname",
      displayId: "tiktok_user",
    },
    common: { msgId: "chat-message-1" },
  }), {
    username: "tiktok_user",
    nickname: "Live nickname",
    comment: "!entrar PlayerOne",
    userId: "12345",
    messageId: "chat-message-1",
  });
});

test("supports legacy TikTok chat message field names", () => {
  assert.deepEqual(normalizeTikTokChatMessage({
    comment: "!pontos",
    user: {
      userId: "67890",
      nickname: "Legacy nickname",
      uniqueId: "legacy_user",
    },
  }), {
    username: "legacy_user",
    nickname: "Legacy nickname",
    comment: "!pontos",
    userId: "67890",
    messageId: "",
  });
});

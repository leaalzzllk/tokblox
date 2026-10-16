import test from "node:test";
import assert from "node:assert/strict";
import { GameState, parseCommand } from "../src/game-state.js";

test("parses TikTok commands and rejects malformed input", () => {
  assert.deepEqual(parseCommand("!entrar Player_123"), { type: "join", username: "Player_123" });
  assert.deepEqual(parseCommand("Player_123"), { type: "join", username: "Player_123" });
  assert.deepEqual(parseCommand("!apostar Player_123 250"), { type: "bet", username: "Player_123", amount: 250 });
  assert.deepEqual(parseCommand("!corrida"), { type: "start" });
  assert.deepEqual(parseCommand("!pontos"), { type: "balance" });
  assert.equal(parseCommand("!entrar bad-name")?.type, "invalid");
  assert.equal(parseCommand("uma frase normal"), null);
  assert.equal(parseCommand("!apostar Player_123 0")?.type, "invalid");
});

test("starts a solo race automatically and lets viewers join while it is running", () => {
  const game = new GameState();
  const first = { id: "1", name: "PlayerOne" };
  const second = { id: "2", name: "PlayerTwo" };
  assert.deepEqual(game.joinRobloxPlayer(first), {
    ok: true,
    queued: true,
    message: "PlayerOne foi adicionado à fila da próxima corrida.",
  });

  const started = game.startAutomaticRace();
  assert.equal(started.ok, true);
  assert.equal(started.raceId, 1);
  assert.deepEqual(game.joinRobloxPlayer(second), {
    ok: true,
    queued: false,
    message: "PlayerTwo foi adicionado à corrida em andamento.",
  });
  assert.equal(game.joinRobloxPlayer(second).ok, false);
  assert.deepEqual(game.getEventsAfter(0).map((event) => event.type), [
    "player_joined",
    "race_started",
    "racer_joined",
  ]);
  assert.equal(game.finishRace(1, "2").ok, true);
});

test("queues the same TikTok viewer's repeated racer for the next race", () => {
  const game = new GameState();
  const player = { id: "42", name: "PlayerOne" };
  const firstSource = { tiktokUserId: "viewer-1", tiktokUsername: "viewer_one" };
  const repeatedSource = { ...firstSource, text: "!entrar PlayerOne" };

  assert.equal(game.joinRobloxPlayer(player, firstSource).queued, true);
  assert.equal(game.startAutomaticRace().ok, true);
  const repeatedJoin = game.joinRobloxPlayer(player, repeatedSource);
  assert.equal(repeatedJoin.ok, true);
  assert.equal(repeatedJoin.queued, true);
  assert.equal(repeatedJoin.message, "PlayerOne foi colocado na fila da próxima corrida.");

  const duplicateRepeat = game.joinRobloxPlayer(player, repeatedSource);
  assert.equal(duplicateRepeat.ok, true);
  assert.equal(duplicateRepeat.message, "PlayerOne já está na fila da próxima corrida.");
  assert.equal(game.finishRace(1, player.id).ok, true);
  assert.equal(game.startAutomaticRace().ok, true);
  assert.equal(game.getEventsAfter(0).filter((event) => event.type === "race_started")[1].racers[0].id, player.id);
});

test("does not queue an active racer repeated by a different TikTok viewer", () => {
  const game = new GameState();
  const player = { id: "42", name: "PlayerOne" };

  game.joinRobloxPlayer(player, { tiktokUserId: "viewer-1" });
  game.startAutomaticRace();
  const result = game.joinRobloxPlayer(player, { tiktokUserId: "viewer-2" });

  assert.equal(result.ok, false);
  assert.equal(result.queued, undefined);
  assert.equal(game.getEventsAfter(0).filter((event) => event.type === "player_joined").length, 1);
});

test("keeps the exact TikTok comment with its Roblox join event", () => {
  const game = new GameState();
  const player = { id: "42", name: "PlayerOne" };
  const source = {
    commentId: 17,
    tiktokMessageId: "chat-message-1",
    tiktokUserId: "viewer-1",
    tiktokUsername: "viewer_one",
    text: "!entrar PlayerOne",
  };

  assert.equal(game.joinRobloxPlayer(player, source).queued, true);
  assert.deepEqual(game.getEventsAfter(0)[0], {
    id: 1,
    type: "player_joined",
    player: { ...player, source },
  });
  assert.deepEqual(game.startAutomaticRace().ok, true);
  assert.deepEqual(game.getEventsAfter(1)[0].racers[0].source, source);
});

test("publishes like boosts only for matching TikTok racers during a race", () => {
  const game = new GameState();
  const player = { id: "42", name: "PlayerOne" };
  const source = { tiktokUsername: "viewer_one" };
  game.joinRobloxPlayer(player, source);

  assert.equal(game.publishLikeBoost("viewer_one", 3), 0);
  assert.equal(game.startAutomaticRace().ok, true);
  assert.equal(game.publishLikeBoost("@VIEWER_ONE", 3), 1);
  assert.equal(game.publishLikeBoost("other_viewer", 5), 0);
  assert.equal(game.publishLikeBoost("viewer_one", 0), 0);
  assert.deepEqual(game.getEventsAfter(2), [{
    id: 3,
    type: "like_boost",
    playerId: "42",
    count: 3,
  }]);
});

test("opens a betting round before racing and emits ordered events", () => {
  const game = new GameState();
  assert.equal(game.joinRobloxPlayer({ id: "1", name: "PlayerOne" }).ok, true);
  assert.equal(game.startRace().ok, false);
  assert.equal(game.joinRobloxPlayer({ id: "2", name: "PlayerTwo" }).ok, true);
  assert.equal(game.startRace().ok, true);
  assert.equal(game.joinRobloxPlayer({ id: "3", name: "PlayerThree" }).ok, false);
  assert.equal(game.launchRace(1).ok, true);
  assert.deepEqual(game.getEventsAfter(0).map((event) => event.type), [
    "player_joined",
    "player_joined",
    "betting_open",
    "race_started",
  ]);
});

test("charges one virtual bet per TikTok viewer and pays the winner", () => {
  const game = new GameState();
  game.joinRobloxPlayer({ id: "1", name: "PlayerOne" });
  game.joinRobloxPlayer({ id: "2", name: "PlayerTwo" });
  game.startRace();

  assert.equal(game.placeBet("viewer-1", "viewer1", "PlayerOne", 300).ok, true);
  assert.equal(game.getBalance("viewer-1"), 700);
  assert.equal(game.placeBet("viewer-2", "viewer2", "PlayerTwo", 200).ok, true);
  assert.equal(game.placeBet("viewer-1", "viewer1", "PlayerTwo", 100).ok, false);
  game.launchRace(1);
  assert.equal(game.finishRace(1, "2").ok, true);
  assert.equal(game.getBalance("viewer-1"), 700);
  assert.equal(game.getBalance("viewer-2"), 1200);
  assert.equal(game.placeBet("viewer-3", "viewer3", "PlayerOne", 100).ok, false);
});

test("rejects invalid race results and makes result retries idempotent", () => {
  const game = new GameState();
  game.joinRobloxPlayer({ id: "1", name: "PlayerOne" });
  game.joinRobloxPlayer({ id: "2", name: "PlayerTwo" });
  game.startRace();
  game.launchRace(1);

  assert.equal(game.finishRace(1, "unknown").ok, false);
  assert.equal(game.finishRace(1, "1").ok, true);
  assert.equal(game.finishRace(1, "1").ok, true);
  assert.equal(game.finishRace(1, "2").status, 409);
});

test("publishes configured gift actions to Roblox without changing race state", () => {
  const game = new GameState();
  game.publishGiftEffect({
    giftId: "5655",
    giftName: "Rosa",
    sender: "viewer1",
    senderTikTokUserId: "viewer-id-1",
    count: 2,
    action: "boost_sender",
  });

  assert.deepEqual(game.getEventsAfter(0), [{
    id: 1,
    type: "gift_effect",
    giftId: "5655",
    giftName: "Rosa",
    sender: "viewer1",
    senderTikTokUserId: "viewer-id-1",
    count: 2,
    action: "boost_sender",
  }]);
});

test("publishes a connection test event without starting a race", () => {
  const game = new GameState();
  game.publishConnectionTest("test-123");

  assert.deepEqual(game.getEventsAfter(0), [{
    id: 1,
    type: "connection_test",
    testId: "test-123",
  }]);
});

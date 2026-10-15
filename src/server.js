import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { GameState, parseCommand } from "./game-state.js";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const PORT = Number(process.env.PORT ?? 3000);
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.replace(/^@/, "");
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY;
const BETTING_WINDOW_MS = 20_000;
const AUTO_RACE_DELAY_MS = 30_000;
const MAX_COMMENTS = 500;
const MAX_RECENT_GIFTS = 100;
const MAX_REQUEST_BODY_LENGTH = 32 * 1024;
const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const GIFT_CONFIG_PATH = path.join(DATA_DIR, "gift-config.json");
const GIFT_EFFECTS = new Set(["confetti", "neon", "celebration"]);

if (!ROBLOX_API_KEY || ROBLOX_API_KEY.length < 32) {
  throw new Error("ROBLOX_API_KEY deve ter pelo menos 32 caracteres.");
}
if (!DASHBOARD_API_KEY || DASHBOARD_API_KEY.length < 32) {
  throw new Error("DASHBOARD_API_KEY deve ter pelo menos 32 caracteres.");
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT deve ser uma porta válida.");
}

const state = new GameState();
const connectionTests = new Map();
const comments = [];
const recentGifts = [];
let giftConfig = await loadGiftConfig();
let giftConfigWrites = Promise.resolve();
let nextCommentId = 1;
let liveConnection = null;
let liveStatus = {
  connected: false,
  connecting: false,
  username: "",
  roomId: null,
  error: null,
};
let liveGeneration = 0;
let autoRaceTimer = null;

async function loadGiftConfig() {
  try {
    const contents = await readFile(GIFT_CONFIG_PATH, "utf8");
    return validateGiftConfig(JSON.parse(contents));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Não foi possível carregar ${GIFT_CONFIG_PATH}: ${error.message}`);
  }
}

function validateGiftConfig(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("A configuração deve conter no máximo 100 presentes.");
  }
  const ids = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Cada configuração de presente deve ser um objeto.");
    }
    const giftId = String(entry.giftId ?? "");
    const giftName = String(entry.giftName ?? "").trim();
    if (!/^\d{1,20}$/.test(giftId)) {
      throw new Error("O ID do presente deve conter apenas números.");
    }
    if (ids.has(giftId)) {
      throw new Error(`O presente ${giftId} está configurado mais de uma vez.`);
    }
    if (!giftName || giftName.length > 80) {
      throw new Error("Informe um nome de presente de até 80 caracteres.");
    }
    if (!GIFT_EFFECTS.has(entry.effect)) {
      throw new Error("Selecione um efeito visual válido.");
    }
    ids.add(giftId);
    return { giftId, giftName, effect: entry.effect };
  });
}

function saveGiftConfig(config) {
  const write = giftConfigWrites.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const temporaryPath = `${GIFT_CONFIG_PATH}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await rename(temporaryPath, GIFT_CONFIG_PATH);
  });
  giftConfigWrites = write.catch((error) => {
    console.error("Erro ao persistir configuração de presentes:", error);
  });
  return write;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_REQUEST_BODY_LENGTH) {
        reject(new Error("Corpo da requisição excede 32 KB."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON inválido."));
      }
    });
    request.on("error", reject);
  });
}

async function resolveRobloxUser(username) {
  const response = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Consulta de usuário Roblox falhou (HTTP ${response.status}).`);
  }

  const result = await response.json();
  const user = result.data?.[0];
  if (!user) {
    return null;
  }
  return { id: String(user.id), name: user.name };
}

function scheduleAutomaticRace() {
  if (autoRaceTimer) return;
  console.info("Primeiro participante na fila; a corrida começará automaticamente em 30 segundos.");
  autoRaceTimer = setTimeout(() => {
    autoRaceTimer = null;
    const result = state.startAutomaticRace();
    console.info(result.message);
  }, AUTO_RACE_DELAY_MS);
}

function cancelAutomaticRace() {
  if (!autoRaceTimer) return;
  clearTimeout(autoRaceTimer);
  autoRaceTimer = null;
}

async function handleComment(data) {
  const comment = String(data.comment ?? "");
  const user = data.user ?? {};
  const commentEvent = {
    id: nextCommentId++,
    username: String(user.uniqueId ?? "desconhecido"),
    nickname: String(user.nickname ?? user.uniqueId ?? "Desconhecido"),
    comment,
    timestamp: new Date().toISOString(),
    command: parseCommand(comment)?.type ?? null,
  };
  comments.push(commentEvent);
  if (comments.length > MAX_COMMENTS) comments.shift();

  const command = parseCommand(comment);
  if (!command) return;

  const viewerId = String(user.userId ?? user.uniqueId ?? "");
  const viewerName = String(user.uniqueId ?? "viewer");
  if (!viewerId) {
    console.warn("Comentário de comando ignorado: TikTok não forneceu um ID de usuário.");
    return;
  }

  if (command.type === "balance") {
    console.info(`@${viewerName}: saldo de ${state.getBalance(viewerId)} pontos virtuais.`);
    return;
  }
  if (command.type === "bet") {
    const result = state.placeBet(viewerId, viewerName, command.username, command.amount);
    console.info(`@${viewerName}: ${result.message}`);
    return;
  }
  if (command.type === "start") {
    const result = state.startRace();
    console.info(`@${viewerName}: ${result.message}`);
    if (result.ok) {
      cancelAutomaticRace();
      setTimeout(() => {
        const launch = state.launchRace(result.raceId);
        console.info(launch.message);
      }, BETTING_WINDOW_MS);
    }
    return;
  }

  try {
    const user = await resolveRobloxUser(command.username);
    if (!user) {
      console.info(`@${viewerName}: o usuário Roblox "${command.username}" não foi encontrado.`);
      return;
    }
    const result = state.joinRobloxPlayer(user);
    console.info(`@${viewerName}: ${result.message}`);
    if (result.queued) scheduleAutomaticRace();
  } catch (error) {
    console.error(`Não foi possível validar o usuário Roblox "${command.username}":`, error);
  }
}

function handleGift(data) {
  if (data.giftDetails?.giftType === 1 && !data.repeatEnd) return;

  const giftId = String(data.giftId ?? "");
  if (!/^\d{1,20}$/.test(giftId)) {
    console.warn("Presente ignorado: o TikTok não forneceu um ID válido.");
    return;
  }
  const giftName = String(data.giftDetails?.giftName ?? `Presente ${giftId}`).slice(0, 80);
  const gift = {
    id: `${Date.now()}-${randomUUID()}`,
    giftId,
    giftName,
    sender: String(data.user?.nickname ?? data.user?.uniqueId ?? "Desconhecido").slice(0, 80),
    count: Math.min(Math.max(Number(data.repeatCount) || 1, 1), 999),
    timestamp: new Date().toISOString(),
    effect: null,
  };

  const configured = giftConfig.find((entry) => entry.giftId === giftId);
  if (configured) {
    gift.effect = configured.effect;
    state.publishGiftEffect({
      giftId,
      giftName: configured.giftName,
      sender: gift.sender,
      count: gift.count,
      effect: configured.effect,
    });
  }

  recentGifts.push(gift);
  if (recentGifts.length > MAX_RECENT_GIFTS) recentGifts.shift();
  console.info(`Presente "${giftName}" (ID ${giftId}) recebido de @${data.user?.uniqueId ?? "desconhecido"}${configured ? `; efeito ${configured.effect}` : ""}.`);
}

function connectToLive(username) {
  const cleanUsername = username.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{2,30}$/.test(cleanUsername)) {
    throw new Error("Informe um usuário TikTok válido, sem espaços.");
  }
  if (liveStatus.connecting) {
    throw new Error("A conexão com uma live já está sendo iniciada.");
  }

  const previousConnection = liveConnection;
  const generation = ++liveGeneration;
  liveConnection = null;
  liveStatus = { connected: false, connecting: true, username: cleanUsername, roomId: null, error: null };

  const connect = async () => {
    try {
      if (previousConnection) {
        await previousConnection.disconnect();
      }
      if (generation !== liveGeneration) return;

      const connection = new TikTokLiveConnection(cleanUsername);
      liveConnection = connection;
      connection.on(WebcastEvent.CHAT, (data) => {
        handleComment(data).catch((error) => {
          console.error("Falha ao processar comentário da live:", error);
        });
      });
      connection.on(WebcastEvent.GIFT, (data) => {
        try {
          handleGift(data);
        } catch (error) {
          console.error("Falha ao processar presente da live:", error);
        }
      });
      connection.on("disconnected", () => {
        if (liveConnection === connection) {
          liveStatus = {
            ...liveStatus,
            connected: false,
            connecting: false,
            roomId: null,
            error: "A conexão com a live foi encerrada.",
          };
        }
      });

      const room = await connection.connect();
      if (liveConnection !== connection) {
        await connection.disconnect();
        return;
      }
      liveStatus = { connected: true, connecting: false, username: cleanUsername, roomId: room.roomId, error: null };
      console.info(`Conectado à live de @${cleanUsername} (sala ${room.roomId}).`);
    } catch (error) {
      if (generation === liveGeneration) {
        liveConnection = null;
        liveStatus = { connected: false, connecting: false, username: cleanUsername, roomId: null, error: error.message };
      }
      throw error;
    }
  };

  return connect();
}

async function disconnectFromLive() {
  liveGeneration += 1;
  const connection = liveConnection;
  liveConnection = null;
  liveStatus = { connected: false, connecting: false, username: "", roomId: null, error: null };
  if (connection) await connection.disconnect();
}

function isAuthorized(request, key) {
  return request.headers["x-api-key"] === key;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && ["/", "/index.html", "/styles.css", "/app.js"].includes(url.pathname)) {
    const fileName = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const contentType = fileName.endsWith(".css")
      ? "text/css; charset=utf-8"
      : fileName.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "text/html; charset=utf-8";
    try {
      const content = await readFile(path.join(APP_DIR, fileName));
      response.writeHead(200, { "content-type": contentType, "cache-control": "no-cache" });
      response.end(content);
    } catch (error) {
      console.error(`Falha ao carregar arquivo da interface ${fileName}:`, error);
      sendJson(response, 500, { error: "Não foi possível carregar o painel." });
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (!isAuthorized(request, DASHBOARD_API_KEY)) {
      sendJson(response, 401, { error: "Chave do painel inválida." });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      sendJson(response, 200, {
        live: liveStatus,
        commentsCount: comments.length,
        giftConfig,
        recentGifts,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/test-roblox") {
      const now = Date.now();
      for (const [testId, test] of connectionTests) {
        if (now - test.createdAt > 10 * 60_000) connectionTests.delete(testId);
      }
      while (connectionTests.size >= 100) {
        connectionTests.delete(connectionTests.keys().next().value);
      }
      const testId = randomUUID();
      connectionTests.set(testId, { status: "pending", createdAt: now });
      state.publishConnectionTest(testId);
      sendJson(response, 202, { testId, status: "pending" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/test-roblox") {
      const testId = url.searchParams.get("testId") ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(testId)) {
        sendJson(response, 400, { error: "Identificador de teste inválido." });
        return;
      }
      const test = connectionTests.get(testId);
      if (!test) {
        sendJson(response, 404, { error: "Teste não encontrado ou expirado." });
        return;
      }
      if (test.status === "pending" && Date.now() - test.createdAt > 60_000) {
        test.status = "expired";
      }
      sendJson(response, 200, { status: test.status });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/gifts") {
      sendJson(response, 200, { config: giftConfig, recent: recentGifts });
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/gifts") {
      try {
        const body = await readJson(request);
        const nextConfig = validateGiftConfig(body.config);
        await saveGiftConfig(nextConfig);
        giftConfig = nextConfig;
        sendJson(response, 200, { config: giftConfig });
      } catch (error) {
        console.error("Falha ao salvar configuração de presentes:", error);
        sendJson(response, 400, { error: error.message });
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/comments") {
      const after = Number(url.searchParams.get("after") ?? "0");
      if (!Number.isSafeInteger(after) || after < 0) {
        sendJson(response, 400, { error: "Cursor inválido." });
        return;
      }
      sendJson(response, 200, { comments: comments.filter((comment) => comment.id > after).slice(-100) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/connect") {
      try {
        const body = await readJson(request);
        if (typeof body.username !== "string") {
          sendJson(response, 400, { error: "Informe o usuário da live." });
          return;
        }
        await connectToLive(body.username);
        sendJson(response, 200, { live: liveStatus });
      } catch (error) {
        console.error("Falha ao conectar à live solicitada pelo painel:", error);
        sendJson(response, 400, { error: error.message });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/disconnect") {
      try {
        await disconnectFromLive();
        sendJson(response, 200, { live: liveStatus });
      } catch (error) {
        console.error("Falha ao desconectar da live:", error);
        sendJson(response, 500, { error: "Não foi possível desconectar da live." });
      }
      return;
    }
    sendJson(response, 404, { error: "Rota do painel não encontrada." });
    return;
  }

  if (!isAuthorized(request, ROBLOX_API_KEY)) {
    sendJson(response, 401, { error: "Não autorizado." });
    return;
  }

  if (request.method === "GET" && url.pathname === "/roblox/events") {
    const cursor = Number(url.searchParams.get("after") ?? "0");
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      sendJson(response, 400, { error: "Cursor inválido." });
      return;
    }
    sendJson(response, 200, { events: state.getEventsAfter(cursor) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/roblox/test-ack") {
    try {
      const body = await readJson(request);
      if (typeof body.testId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.testId)) {
        sendJson(response, 400, { error: "Informe um identificador de teste válido." });
        return;
      }
      const test = connectionTests.get(body.testId);
      if (!test || test.status !== "pending") {
        sendJson(response, 404, { error: "Teste pendente não encontrado." });
        return;
      }
      test.status = "received";
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/roblox/finish") {
    try {
      const body = await readJson(request);
      if (!Number.isSafeInteger(body.raceId) || typeof body.winnerId !== "string") {
        sendJson(response, 400, { error: "Informe raceId e winnerId válidos." });
        return;
      }
      const result = state.finishRace(body.raceId, body.winnerId);
      sendJson(response, result.status ?? (result.ok ? 200 : 400), result);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  sendJson(response, 404, { error: "Rota não encontrada." });
});

server.listen(PORT, "0.0.0.0", () => {
  console.info(`Painel TOKBLOX disponível em http://localhost:${PORT}.`);
});

if (TIKTOK_USERNAME) {
  connectToLive(TIKTOK_USERNAME).catch((error) => {
    console.error(`Não foi possível conectar à live de @${TIKTOK_USERNAME}:`, error);
  });
}

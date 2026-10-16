const form = document.querySelector("#connect-form");
const usernameInput = document.querySelector("#username");
const keyInput = document.querySelector("#dashboard-key");
const connectButton = document.querySelector("#connect-button");
const disconnectButton = document.querySelector("#disconnect-button");
const message = document.querySelector("#connection-message");
const badge = document.querySelector("#connection-badge");
const connectionLabel = document.querySelector("#connection-label");
const feed = document.querySelector("#chat-feed");
const emptyState = document.querySelector("#empty-state");
const countLabel = document.querySelector("#comment-count");
const feedFooter = document.querySelector("#feed-footer");
const giftMessage = document.querySelector("#gift-message");
const giftConfigList = document.querySelector("#gift-config-list");
const recentGiftList = document.querySelector("#recent-gift-list");
const manualGiftForm = document.querySelector("#manual-gift-form");
const manualGiftSubmit = document.querySelector("#manual-gift-submit");
const testButton = document.querySelector("#test-roblox-button");
const testMessage = document.querySelector("#test-message");
let cursor = 0;
let commentUpdateCursor = 0;
let totalComments = 0;
let lastKnownLive = false;
let polling = false;
let renderedGiftConfig = "";
let renderedRecentGifts = "";
let giftConfig = [];
let observedGifts = [];
const commentRows = new Map();

const effectLabels = {
  confetti: "Chuva de confete",
  neon: "Brilho neon",
  celebration: "Celebração",
};

function setMessage(text, kind = "") {
  message.textContent = text;
  message.dataset.kind = kind;
}

async function api(path, options = {}) {
  const key = keyInput.value.trim();
  if (!key) throw new Error("Digite a DASHBOARD_API_KEY configurada no .env.");
  const response = await fetch(path, {
    ...options,
    headers: {
      "x-api-key": key,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Erro HTTP ${response.status}.`);
  return result;
}

function renderStatus(live) {
  const state = live.connecting ? "connecting" : live.connected ? "connected" : "offline";
  badge.dataset.state = state;
  connectionLabel.textContent = live.connecting
    ? "Conectando..."
    : live.connected
      ? `Ao vivo · @${live.username}`
      : "Desconectado";
  connectButton.disabled = live.connecting || live.connected;
  disconnectButton.hidden = !live.connected && !live.connecting;
  feedFooter.textContent = live.connected
    ? `Comentários de @${live.username}`
    : "Conecte uma live para começar";
  document.querySelector(".chat-footer").dataset.connected = String(live.connected);

  if (live.connected && !lastKnownLive) {
    setMessage(`Conectado à live de @${live.username}.`, "success");
  } else if (live.error) {
    setMessage(live.error, "error");
  }
  lastKnownLive = live.connected;
}

function renderGiftConfiguration(config) {
  const signature = JSON.stringify(config);
  if (signature === renderedGiftConfig) return;
  renderedGiftConfig = signature;
  giftConfig = config;
  document.querySelector("#gift-config-count").textContent = `${config.length} / 100`;
  giftConfigList.replaceChildren();
  if (config.length === 0) {
    const empty = document.createElement("div");
    empty.className = "gift-list-empty";
    empty.textContent = "Nenhum presente configurado ainda.";
    giftConfigList.append(empty);
    return;
  }

  for (const gift of config) {
    const item = document.createElement("div");
    item.className = "gift-config-item";
    const icon = document.createElement("span");
    icon.className = "gift-emoji";
    icon.textContent = "✦";
    const main = document.createElement("div");
    main.className = "gift-item-main";
    const name = document.createElement("div");
    name.className = "gift-item-name";
    name.textContent = gift.giftName;
    const subtitle = document.createElement("div");
    subtitle.className = "gift-item-subtitle";
    subtitle.textContent = `ID ${gift.giftId}`;
    main.append(name, subtitle);
    const effect = createEffectSelect(gift.effect);
    effect.dataset.effectForGiftId = gift.giftId;
    const remove = document.createElement("button");
    remove.className = "gift-remove-button";
    remove.type = "button";
    remove.dataset.removeGiftId = gift.giftId;
    remove.setAttribute("aria-label", `Remover configuração de ${gift.giftName}`);
    remove.textContent = "×";
    const save = document.createElement("button");
    save.className = "gift-action-button";
    save.type = "button";
    save.dataset.saveGiftId = gift.giftId;
    save.dataset.saveGiftName = gift.giftName;
    save.textContent = "Salvar";
    item.append(icon, main, effect, save, remove);
    giftConfigList.append(item);
  }
}

function createEffectSelect(selectedEffect) {
  const select = document.createElement("select");
  select.className = "gift-effect-select";
  select.setAttribute("aria-label", "O que acontece no jogo");
  for (const [value, label] of Object.entries(effectLabels)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selectedEffect;
    select.append(option);
  }
  return select;
}

function renderRecentGifts(gifts) {
  const signature = JSON.stringify(gifts);
  if (signature === renderedRecentGifts) return;
  renderedRecentGifts = signature;
  observedGifts = gifts;
  recentGiftList.replaceChildren();
  if (gifts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "gift-list-empty";
    empty.textContent = "Conecte a live para detectar os presentes enviados.";
    recentGiftList.append(empty);
    return;
  }

  const latestByGiftId = new Map();
  for (const gift of gifts) latestByGiftId.set(gift.giftId, gift);
  for (const gift of [...latestByGiftId.values()].reverse().slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "recent-gift-item";
    const icon = document.createElement("span");
    icon.className = "gift-emoji";
    icon.textContent = "✦";
    const main = document.createElement("div");
    main.className = "gift-item-main";
    const name = document.createElement("div");
    name.className = "gift-item-name";
    name.textContent = `${gift.giftName}${gift.count > 1 ? ` ×${gift.count}` : ""}`;
    const subtitle = document.createElement("div");
    subtitle.className = "gift-item-subtitle";
    subtitle.textContent = `ID ${gift.giftId} · ${gift.sender}`;
    main.append(name, subtitle);
    item.append(icon, main);

    const configured = giftConfig.find((entry) => entry.giftId === gift.giftId);
    const effect = createEffectSelect(configured?.effect ?? "confetti");
    effect.dataset.effectForGiftId = gift.giftId;
    const action = document.createElement("button");
    action.className = "gift-action-button";
    action.type = "button";
    action.dataset.saveGiftId = gift.giftId;
    action.dataset.saveGiftName = gift.giftName;
    action.textContent = configured ? "Salvar" : "Adicionar";
    item.append(effect, action);
    recentGiftList.append(item);
  }
}

async function saveGiftConfiguration(giftId, giftName, effect) {
  const nextConfig = giftConfig.filter((gift) => gift.giftId !== giftId);
  nextConfig.push({ giftId, giftName, effect });
  if (nextConfig.length > 100) {
    throw new Error("O limite é de 100 presentes configurados.");
  }
  const result = await api("/api/gifts", {
    method: "PUT",
    body: JSON.stringify({ config: nextConfig }),
  });
  renderGiftConfiguration(result.config);
  renderedRecentGifts = "";
  renderRecentGifts(observedGifts);
}

async function removeGiftConfiguration(giftId) {
  const nextConfig = giftConfig.filter((gift) => gift.giftId !== giftId);
  const result = await api("/api/gifts", {
    method: "PUT",
    body: JSON.stringify({ config: nextConfig }),
  });
  renderGiftConfiguration(result.config);
  renderedRecentGifts = "";
  renderRecentGifts(observedGifts);
}

function commandLabel(comment) {
  if (comment.command === "join") return "ENTRADA";
  if (comment.command === "start") return "CORRIDA";
  if (comment.command === "bet") return "APOSTA";
  if (comment.command === "balance") return "PONTOS";
  if (comment.command === "invalid") return "COMANDO INVÁLIDO";
  return "";
}

function appendComment(comment) {
  if (emptyState.isConnected) emptyState.remove();
  const row = document.createElement("article");
  row.className = "comment";
  row.dataset.commentId = comment.id;

  const avatar = document.createElement("div");
  avatar.className = "comment-avatar";
  avatar.textContent = (comment.nickname || comment.username || "?").trim().charAt(0).toUpperCase();

  const main = document.createElement("div");
  main.className = "comment-main";
  const meta = document.createElement("div");
  meta.className = "comment-meta";

  const nickname = document.createElement("span");
  nickname.className = "comment-nickname";
  nickname.textContent = comment.nickname || comment.username || "Desconhecido";
  const username = document.createElement("span");
  username.className = "comment-username";
  username.textContent = `@${comment.username || "desconhecido"}`;
  const time = document.createElement("time");
  time.className = "comment-time";
  time.dateTime = comment.timestamp;
  time.textContent = new Date(comment.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  meta.append(nickname, username, time);

  const text = document.createElement("p");
  text.className = "comment-text";
  text.textContent = comment.comment;
  main.append(meta, text);

  const label = commandLabel(comment);
  if (label) {
    const tag = document.createElement("span");
    tag.className = "comment-tag";
    tag.textContent = `COMANDO ${label}`;
    main.append(tag);
  }
  if (comment.commandResult) {
    const result = document.createElement("p");
    result.className = "comment-result";
    result.textContent = comment.commandResult;
    main.append(result);
  }
  row.append(avatar, main);
  feed.append(row);
  commentRows.set(comment.id, row);
}

function updateCommentResult(update) {
  const row = commentRows.get(update.commentId);
  if (!row) return;

  let result = row.querySelector(".comment-result");
  if (!result) {
    result = document.createElement("p");
    result.className = "comment-result";
    row.querySelector(".comment-main").append(result);
  }
  result.textContent = update.commandResult;
}

async function poll() {
  if (polling || !keyInput.value.trim()) return;
  polling = true;
  try {
    const [status, result] = await Promise.all([
      api("/api/status"),
      api(`/api/comments?after=${cursor}&updatesAfter=${commentUpdateCursor}`),
    ]);
    renderStatus(status.live);
    renderGiftConfiguration(status.giftConfig);
    renderRecentGifts(status.recentGifts);
    const wasNearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    for (const comment of result.comments) {
      appendComment(comment);
      cursor = Math.max(cursor, comment.id);
      totalComments += 1;
    }
    for (const update of result.updates) {
      updateCommentResult(update);
      commentUpdateCursor = Math.max(commentUpdateCursor, update.id);
    }
    commentUpdateCursor = Math.max(commentUpdateCursor, result.updateCursor);
    while (feed.querySelectorAll(".comment").length > 200) {
      const oldest = feed.querySelector(".comment");
      if (oldest) {
        commentRows.delete(Number(oldest.dataset.commentId));
        oldest.remove();
      }
    }
    if (wasNearBottom) feed.scrollTop = feed.scrollHeight;
    countLabel.textContent = String(totalComments);
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    polling = false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  connectButton.disabled = true;
  setMessage("Conectando à live...", "");
  badge.dataset.state = "connecting";
  connectionLabel.textContent = "Conectando...";
  try {
    await api("/api/connect", {
      method: "POST",
      body: JSON.stringify({ username: usernameInput.value }),
    });
    setMessage("Live conectada. Aguardando comentários...", "success");
    await poll();
  } catch (error) {
    connectButton.disabled = false;
    badge.dataset.state = "offline";
    connectionLabel.textContent = "Desconectado";
    setMessage(error.message, "error");
  }
});

disconnectButton.addEventListener("click", async () => {
  disconnectButton.disabled = true;
  try {
    await api("/api/disconnect", { method: "POST" });
    setMessage("Live desconectada.", "");
    renderStatus({ connected: false, connecting: false, username: "", error: null });
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    disconnectButton.disabled = false;
  }
});

for (const tab of document.querySelectorAll(".dashboard-tab")) {
  tab.addEventListener("click", () => {
    for (const otherTab of document.querySelectorAll(".dashboard-tab")) {
      const selected = otherTab === tab;
      otherTab.classList.toggle("is-active", selected);
      otherTab.setAttribute("aria-selected", String(selected));
    }
    for (const panel of ["live-panel", "gift-panel", "test-panel"]) {
      document.querySelector(`#${panel}`).hidden = tab.dataset.tab !== panel;
    }
  });
}

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  testMessage.textContent = "Enviando evento de teste...";
  testMessage.dataset.kind = "";
  try {
    const { testId } = await api("/api/test-roblox", { method: "POST" });
    testMessage.textContent = "Evento enviado. Aguardando o script do Roblox responder...";
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const result = await api(`/api/test-roblox?testId=${encodeURIComponent(testId)}`);
      if (result.status === "received") {
        testMessage.textContent = "Conexão confirmada! O script do Roblox recebeu o teste.";
        testMessage.dataset.kind = "success";
        return;
      }
      if (result.status === "expired") break;
    }
    throw new Error("O Roblox não confirmou o teste em 30 segundos. Verifique a URL, a chave e se o Script está em execução.");
  } catch (error) {
    testMessage.textContent = error.message;
    testMessage.dataset.kind = "error";
  } finally {
    testButton.disabled = false;
  }
});

async function handleGiftAction(event) {
  const removeButton = event.target.closest("[data-remove-gift-id]");
  if (removeButton) {
    try {
      await removeGiftConfiguration(removeButton.dataset.removeGiftId);
      giftMessage.textContent = "Ação removida deste presente.";
      giftMessage.dataset.kind = "success";
    } catch (error) {
      giftMessage.textContent = error.message;
      giftMessage.dataset.kind = "error";
    }
    return;
  }

  const saveButton = event.target.closest("[data-save-gift-id]");
  if (!saveButton) return;
  const row = saveButton.closest(".gift-config-item, .recent-gift-item");
  const effect = row.querySelector("[data-effect-for-gift-id]").value;
  saveButton.disabled = true;
  try {
    await saveGiftConfiguration(
      saveButton.dataset.saveGiftId,
      saveButton.dataset.saveGiftName,
      effect,
    );
    giftMessage.textContent = `Ação salva para ${saveButton.dataset.saveGiftName}.`;
    giftMessage.dataset.kind = "success";
  } catch (error) {
    giftMessage.textContent = error.message;
    giftMessage.dataset.kind = "error";
  } finally {
    saveButton.disabled = false;
  }
}

giftConfigList.addEventListener("click", handleGiftAction);
recentGiftList.addEventListener("click", handleGiftAction);

manualGiftForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(manualGiftForm);
  const giftId = String(formData.get("giftId")).trim();
  const giftName = String(formData.get("giftName")).trim();
  const effect = String(formData.get("effect"));
  manualGiftSubmit.disabled = true;
  try {
    await saveGiftConfiguration(giftId, giftName, effect);
    manualGiftForm.reset();
    giftMessage.textContent = `Presente "${giftName}" configurado.`;
    giftMessage.dataset.kind = "success";
  } catch (error) {
    giftMessage.textContent = error.message;
    giftMessage.dataset.kind = "error";
  } finally {
    manualGiftSubmit.disabled = false;
  }
});

keyInput.addEventListener("input", () => {
  cursor = 0;
  commentUpdateCursor = 0;
  poll();
});

setInterval(poll, 1000);

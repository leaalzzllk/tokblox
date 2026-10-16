const STARTING_POINTS = 1000;
const MAX_RACERS = 8;
const MAX_RACE_ENTRANTS = 8;
const MAX_BET = 1000;
const MAX_EVENTS = 2000;

export class GameState {
  #balances = new Map();
  #betsByViewer = new Map();
  #entrants = new Map();
  #events = [];
  #nextEventId = 1;
  #nextRaceId = 1;
  #race = null;

  getBalance(viewerId) {
    return this.#balances.get(viewerId) ?? STARTING_POINTS;
  }

  joinRobloxPlayer(user, source = null) {
    const player = source ? { ...user, source } : user;
    if (this.#race?.status === "running") {
      const activeRacer = this.#race.racers.find((racer) => racer.id === player.id);
      if (activeRacer) {
        const tiktokUserId = source?.tiktokUserId;
        if (tiktokUserId && activeRacer.source?.tiktokUserId === tiktokUserId) {
          if (this.#entrants.has(player.id)) {
            return { ok: true, queued: true, message: `${player.name} já está na fila da próxima corrida.` };
          }
          if (this.#entrants.size >= MAX_RACERS) {
            return { ok: false, message: "A fila está cheia (máximo de 8 corredores)." };
          }

          this.#entrants.set(player.id, player);
          this.#publish({ type: "player_joined", player });
          return { ok: true, queued: true, message: `${player.name} foi colocado na fila da próxima corrida.` };
        }
        return { ok: false, message: `${player.name} já está participando da corrida.` };
      }
      if (this.#race.racers.length >= MAX_RACE_ENTRANTS) {
        return { ok: false, message: "A corrida atual já atingiu o limite de 8 participantes." };
      }
      this.#race.racers.push(player);
      this.#publish({ type: "racer_joined", raceId: this.#race.id, player });
      return { ok: true, queued: false, message: `${player.name} foi adicionado à corrida em andamento.` };
    }
    if (this.#race?.status === "betting") {
      return { ok: false, message: "As apostas já começaram. Tente entrar na próxima corrida." };
    }
    if (this.#entrants.has(player.id)) {
      return { ok: false, message: `${player.name} já está na fila.` };
    }
    if (this.#entrants.size >= MAX_RACERS) {
      return { ok: false, message: "A fila está cheia (máximo de 8 corredores)." };
    }

    this.#entrants.set(player.id, player);
    this.#publish({ type: "player_joined", player });
    return { ok: true, queued: true, message: `${player.name} foi adicionado à fila da próxima corrida.` };
  }

  startAutomaticRace() {
    if (this.#race?.status === "betting" || this.#race?.status === "running") {
      return { ok: false, message: "Já existe uma corrida em andamento." };
    }
    if (this.#entrants.size === 0) {
      return { ok: false, message: "Não há participantes na fila." };
    }

    const racers = [...this.#entrants.values()];
    this.#entrants.clear();
    this.#betsByViewer.clear();
    this.#race = {
      id: this.#nextRaceId++,
      racers,
      status: "running",
      winnerId: null,
      bets: [],
    };
    this.#publish({ type: "race_started", raceId: this.#race.id, racers });
    return { ok: true, raceId: this.#race.id, message: `Corrida ${this.#race.id} iniciada com ${racers.length} participante(s).` };
  }

  startRace() {
    if (this.#race?.status === "betting" || this.#race?.status === "running") {
      return { ok: false, message: "Já existe uma corrida em andamento." };
    }
    if (this.#entrants.size < 2) {
      return { ok: false, message: "São necessários pelo menos 2 corredores." };
    }

    const racers = [...this.#entrants.values()];
    this.#entrants.clear();
    this.#race = {
      id: this.#nextRaceId++,
      racers,
      status: "betting",
      winnerId: null,
      bets: [],
    };
    this.#betsByViewer.clear();
    this.#publish({ type: "betting_open", raceId: this.#race.id, racers });
    return { ok: true, raceId: this.#race.id, message: `Apostas abertas para a corrida ${this.#race.id}.` };
  }

  launchRace(raceId) {
    if (!this.#race || this.#race.id !== raceId || this.#race.status !== "betting") {
      return { ok: false, message: "A rodada de apostas não está mais aberta." };
    }
    this.#race.status = "running";
    this.#publish({ type: "race_started", raceId: this.#race.id, racers: this.#race.racers });
    return { ok: true, message: `Corrida ${this.#race.id} iniciada!` };
  }

  placeBet(viewerId, viewerName, username, amount) {
    if (!this.#race || this.#race.status !== "betting") {
      return { ok: false, message: "Não há rodada de apostas aberta." };
    }
    const player = this.#race.racers.find((racer) => racer.name.toLowerCase() === username.toLowerCase());
    if (!player) {
      return { ok: false, message: `${username} não está participando da corrida atual.` };
    }
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_BET) {
      return { ok: false, message: "A aposta deve ser de 1 a 1000 pontos." };
    }
    if (this.#betsByViewer.has(viewerId)) {
      return { ok: false, message: "Você já apostou nesta corrida." };
    }

    const balance = this.getBalance(viewerId);
    if (amount > balance) {
      return { ok: false, message: `Saldo insuficiente. Você tem ${balance} pontos.` };
    }

    const bet = { viewerId, viewerName, player, amount };
    this.#balances.set(viewerId, balance - amount);
    this.#betsByViewer.set(viewerId, bet);
    this.#race.bets.push(bet);
    this.#publish({
      type: "bet_placed",
      raceId: this.#race.id,
      bettor: viewerName,
      username: player.name,
      amount,
    });
    return { ok: true, message: `Aposta de ${amount} pontos em ${player.name} registrada.` };
  }

  finishRace(raceId, winnerId) {
    if (!this.#race || this.#race.id !== raceId) {
      return { ok: false, status: 404, message: "Corrida não encontrada." };
    }
    if (this.#race.status !== "running" && this.#race.status !== "finished") {
      return { ok: false, status: 409, message: "A corrida ainda não começou." };
    }
    const winner = this.#race.racers.find((racer) => racer.id === winnerId);
    if (!winner) {
      return { ok: false, status: 400, message: "O vencedor não pertence a esta corrida." };
    }
    if (this.#race.status === "finished") {
      if (this.#race.winnerId === winnerId) {
        return { ok: true, message: "Resultado já registrado.", winner };
      }
      return { ok: false, status: 409, message: "Esta corrida já foi encerrada com outro vencedor." };
    }

    this.#race.status = "finished";
    this.#race.winnerId = winnerId;
    const payouts = this.#race.bets.map((bet) => {
      const won = bet.player.id === winnerId;
      const payout = won ? bet.amount * 2 : 0;
      if (payout > 0) {
        this.#balances.set(bet.viewerId, this.getBalance(bet.viewerId) + payout);
      }
      return { bettor: bet.viewerName, amount: bet.amount, payout, won };
    });
    this.#publish({ type: "race_finished", raceId, winner, payouts });
    return { ok: true, message: `${winner.name} venceu a corrida ${raceId}.`, winner, payouts };
  }

  getEventsAfter(cursor) {
    return this.#events.filter((event) => event.id > cursor);
  }

  publishGiftEffect(gift) {
    this.#publish({ type: "gift_effect", ...gift });
  }

  publishLikeBoost(tiktokUsername, count) {
    const username = String(tiktokUsername ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!username || !Number.isSafeInteger(count) || count < 1 || this.#race?.status !== "running") {
      return 0;
    }

    const racers = this.#race.racers.filter((racer) =>
      String(racer.source?.tiktokUsername ?? "").trim().replace(/^@/, "").toLowerCase() === username);
    for (const racer of racers) {
      this.#publish({ type: "like_boost", playerId: racer.id, count });
    }
    return racers.length;
  }

  publishConnectionTest(testId) {
    this.#publish({ type: "connection_test", testId });
  }

  #publish(event) {
    this.#events.push({ id: this.#nextEventId++, ...event });
    if (this.#events.length > MAX_EVENTS) {
      this.#events.splice(0, this.#events.length - MAX_EVENTS);
    }
  }
}

export function parseCommand(comment) {
  const parts = comment.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();

  if (command === "!entrar" && parts.length === 2) {
    return /^[A-Za-z0-9_]{3,20}$/.test(parts[1])
      ? { type: "join", username: parts[1] }
      : { type: "invalid", message: "Use !entrar seguido de um usuário Roblox válido (3 a 20 letras, números ou _)." };
  }
  if (command === "!apostar" && parts.length === 3) {
    const amount = Number(parts[2]);
    return /^[A-Za-z0-9_]{3,20}$/.test(parts[1]) && Number.isSafeInteger(amount) && amount >= 1 && amount <= MAX_BET
      ? { type: "bet", username: parts[1], amount }
      : { type: "invalid", message: "Use !apostar UsuarioRoblox quantidade (de 1 a 1000)." };
  }
  if (command === "!corrida" && parts.length === 1) {
    return { type: "start" };
  }
  if (command === "!pontos" && parts.length === 1) {
    return { type: "balance" };
  }
  if (parts.length === 1 && /^[A-Za-z0-9_]{3,20}$/.test(parts[0])) {
    return { type: "join", username: parts[0] };
  }
  return null;
}

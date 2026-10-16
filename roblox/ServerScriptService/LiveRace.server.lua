local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local API_BASE_URL = "https://tokblox.onrender.com"
local API_KEY = "COLOQUE_A_MESMA_CHAVE_DO_ROBLOX_API_KEY"
local POLL_SECONDS = 2
local TRACK_LENGTH = 300
local RACE_JOIN_WINDOW_SECONDS = 30
local MAX_RACERS = 8
local LIKE_BOOST_PER_LIKE = 0.01
local MAX_SPEED_MULTIPLIER = 2
local MIN_GIFT_SPEED_MULTIPLIER = 0.2
local MAX_GIFT_SPEED_MULTIPLIER = 2

local carsFolder = Instance.new("Folder")
carsFolder.Name = "LiveRaceCars"
carsFolder.Parent = Workspace

local carsById = {}
local laneById = {}
local laneSpacing = 12
local nextLane = 0
local cursor = 0
local raceRunning = false
local activeRace = nil

local function createTrack()
	local track = Instance.new("Part")
	track.Name = "LiveRaceTrack"
	track.Anchored = true
	track.Size = Vector3.new(110, 1, TRACK_LENGTH + 40)
	track.Position = Vector3.new(0, -0.5, -(TRACK_LENGTH / 2))
	track.Material = Enum.Material.Asphalt
	track.Color = Color3.fromRGB(48, 51, 58)
	track.Parent = Workspace

	local finish = Instance.new("Part")
	finish.Name = "FinishLine"
	finish.Anchored = true
	finish.Size = Vector3.new(110, 0.1, 3)
	finish.Position = Vector3.new(0, 0.06, -TRACK_LENGTH)
	finish.Material = Enum.Material.Neon
	finish.Color = Color3.fromRGB(255, 235, 59)
	finish.Parent = Workspace
end

local function makePart(model, name, size, offset, color, material)
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.CanCollide = false
	part.Size = size
	part.CFrame = model.PrimaryPart.CFrame * CFrame.new(offset)
	part.Color = color
	part.Material = material
	part.Parent = model
	return part
end

local function spawnCar(player)
	if carsById[player.id] then
		return carsById[player.id]
	end
	if nextLane >= MAX_RACERS then
		warn("A fila de carros atingiu o limite configurado.")
		return nil
	end

	local lane = nextLane
	nextLane += 1
	local x = (lane - (MAX_RACERS - 1) / 2) * laneSpacing
	local model = Instance.new("Model")
	model.Name = player.name

	local body = Instance.new("Part")
	body.Name = "Chassis"
	body.Anchored = true
	body.CanCollide = false
	body.Size = Vector3.new(8, 2, 12)
	body.Position = Vector3.new(x, 2, 0)
	body.Material = Enum.Material.Metal
	body.Color = Color3.fromHSV((lane / MAX_RACERS) % 1, 0.8, 0.95)
	body.Parent = model
	model.PrimaryPart = body

	makePart(model, "Cabin", Vector3.new(5, 2, 5), Vector3.new(0, 2, 0.5), Color3.fromRGB(100, 200, 255), Enum.Material.Glass)
	for _, side in ipairs({ -1, 1 }) do
		for _, z in ipairs({ -3.5, 3.5 }) do
			makePart(model, "Wheel", Vector3.new(2, 1, 3), Vector3.new(side * 4, -0.5, z), Color3.fromRGB(25, 25, 25), Enum.Material.SmoothPlastic)
		end
	end

	local label = Instance.new("BillboardGui")
	label.Name = "PlayerName"
	label.Adornee = body
	label.Size = UDim2.fromOffset(220, 44)
	label.StudsOffset = Vector3.new(0, 4, 0)
	label.AlwaysOnTop = true
	label.Parent = body

	local text = Instance.new("TextLabel")
	text.Size = UDim2.fromScale(1, 1)
	text.BackgroundTransparency = 0.2
	text.BackgroundColor3 = Color3.fromRGB(15, 15, 20)
	text.TextColor3 = Color3.new(1, 1, 1)
	text.Font = Enum.Font.GothamBold
	text.TextScaled = true
	text.Text = player.name
	text.Parent = label

	model.Parent = carsFolder
	carsById[player.id] = model
	laneById[player.id] = lane
	return model
end

local function request(path, method, body)
	local options = {
		Url = API_BASE_URL .. path,
		Method = method,
		Headers = { ["x-api-key"] = API_KEY },
	}
	if body then
		options.Headers["Content-Type"] = "application/json"
		options.Body = HttpService:JSONEncode(body)
	end

	local response = HttpService:RequestAsync(options)
	if not response.Success then
		error(string.format("Gateway respondeu HTTP %d: %s", response.StatusCode, response.Body))
	end
	return response.Body ~= "" and HttpService:JSONDecode(response.Body) or {}
end

local function addRacerToRace(race, player)
	for _, racer in ipairs(race.racers) do
		if racer.player.id == player.id then
			return
		end
	end

	local car = spawnCar(player)
	if not car then
		return
	end
	if player.source then
		print(string.format(
			"Roblox adicionou %s à corrida pelo comentário #%s de @%s: %q (TikTok msg %s).",
			player.name,
			tostring(player.source.commentId),
			player.source.tiktokUsername,
			player.source.text,
			player.source.tiktokMessageId ~= "" and player.source.tiktokMessageId or "sem ID"
		))
	end

	local lane = laneById[player.id]
	local start = CFrame.new((lane - (MAX_RACERS - 1) / 2) * laneSpacing, 2, 0)
	car:PivotTo(start)
	local baseSpeed = math.random(70, 110)
	table.insert(race.racers, {
		player = player,
		car = car,
		start = start,
		baseSpeed = baseSpeed,
		speed = baseSpeed,
		likes = 0,
		giftSpeedMultiplier = 1,
		distance = 0,
		finishedAt = nil,
	})
end

local function runRace(event)
	if raceRunning then
		warn("Evento de corrida ignorado: já há uma corrida em andamento.")
		return
	end
	raceRunning = true
	activeRace = { id = event.raceId, racers = {} }

	for _, player in ipairs(event.racers) do
		addRacerToRace(activeRace, player)
	end

	if #activeRace.racers == 0 then
		activeRace = nil
		raceRunning = false
		warn("Corrida cancelada: não foi possível criar os carros.")
		return
	end

	local joinWindowEndsAt = os.clock() + RACE_JOIN_WINDOW_SECONDS
	local lastUpdateAt = os.clock()
	local winner
	repeat
		local now = os.clock()
		local deltaTime = math.max(0, now - lastUpdateAt)
		lastUpdateAt = now
		local allRacersFinished = true
		local winningFinishTime = math.huge

		for _, racer in ipairs(activeRace.racers) do
			if not racer.finishedAt then
				local timeToFinish = (TRACK_LENGTH - racer.distance) / racer.speed
				if deltaTime >= timeToFinish then
					racer.distance = TRACK_LENGTH
					racer.finishedAt = now - (deltaTime - timeToFinish)
				else
					racer.distance += racer.speed * deltaTime
				end
			end
			racer.car:PivotTo(racer.start * CFrame.new(0, 0, -racer.distance))
			if not racer.finishedAt then
				allRacersFinished = false
			end
			if racer.finishedAt and racer.finishedAt < winningFinishTime then
				winner = racer.player
				winningFinishTime = racer.finishedAt
			end
		end

		if now >= joinWindowEndsAt and allRacersFinished then
			break
		end
		RunService.Heartbeat:Wait()
	until false

	local ok, err = pcall(function()
		request("/roblox/finish", "POST", { raceId = event.raceId, winnerId = winner.id })
	end)
	if not ok then
		warn("Não foi possível registrar o resultado da corrida: " .. tostring(err))
	end
	print(string.format("Corrida %d vencida por %s", event.raceId, winner.name))
	activeRace = nil
	raceRunning = false
end

local function updateRacerSpeed(racer)
	local likeMultiplier = 1 + racer.likes * LIKE_BOOST_PER_LIKE
	racer.speed = racer.baseSpeed * math.min(
		likeMultiplier * racer.giftSpeedMultiplier,
		MAX_SPEED_MULTIPLIER
	)
end

local function applyLikeBoost(event)
	if not activeRace or type(event.playerId) ~= "string" or type(event.count) ~= "number" or event.count < 1 then
		return
	end

	for _, racer in ipairs(activeRace.racers) do
		if racer.player.id == event.playerId and not racer.finishedAt then
			racer.likes = math.min(racer.likes + math.floor(event.count), 100)
			updateRacerSpeed(racer)
			local multiplier = math.min(1 + racer.likes * LIKE_BOOST_PER_LIKE, MAX_SPEED_MULTIPLIER)
			print(string.format(
				"%s recebeu %d curtida(s): velocidade agora %.1f (+%d%%).",
				racer.player.name,
				math.floor(event.count),
				racer.speed,
				math.floor((multiplier - 1) * 100)
			))
			return
		end
	end
end

local function findRacerByTikTokUser(event)
	if not activeRace then
		return nil
	end
	local senderId = tostring(event.senderTikTokUserId or "")
	local senderName = string.lower(tostring(event.senderTikTokUsername or ""):gsub("^@", ""))
	for _, racer in ipairs(activeRace.racers) do
		local source = racer.player.source or {}
		local sourceName = string.lower(tostring(source.tiktokUsername or ""):gsub("^@", ""))
		if (senderId ~= "" and source.tiktokUserId == senderId)
			or (senderName ~= "" and sourceName == senderName) then
			if not racer.finishedAt then
				return racer
			end
		end
	end
	return nil
end

local function applyGiftAction(event)
	if not activeRace or type(event.count) ~= "number" or event.count < 1 then
		return
	end

	local giftCount = math.min(math.floor(event.count), 999)
	if event.action == "slow_leader" then
		local leader
		for _, racer in ipairs(activeRace.racers) do
			if not racer.finishedAt and (not leader or racer.distance > leader.distance) then
				leader = racer
			end
		end
		if not leader then
			return
		end
		leader.giftSpeedMultiplier = math.max(
			MIN_GIFT_SPEED_MULTIPLIER,
			leader.giftSpeedMultiplier * (0.8 ^ giftCount)
		)
		updateRacerSpeed(leader)
		print(string.format("%s recebeu %s: velocidade reduzida; agora %.1f.", leader.player.name, event.giftName, leader.speed))
	elseif event.action == "boost_sender" or event.action == "add_likes" then
		local racer = findRacerByTikTokUser(event)
		if not racer then
			print(string.format("Presente %s recebido, mas @%s não tem carro ativo na corrida.", event.giftName, event.sender))
			return
		end

		if event.action == "boost_sender" then
			racer.giftSpeedMultiplier = math.min(
				MAX_GIFT_SPEED_MULTIPLIER,
				racer.giftSpeedMultiplier * (1.3 ^ giftCount)
			)
			updateRacerSpeed(racer)
			print(string.format("%s recebeu %s: velocidade agora %.1f.", racer.player.name, event.giftName, racer.speed))
		else
			local previousLikes = racer.likes
			racer.likes = math.min(racer.likes + 50 * giftCount, 100)
			local addedLikes = racer.likes - previousLikes
			updateRacerSpeed(racer)
			print(string.format("%s recebeu %s: +%d curtidas; velocidade agora %.1f.", racer.player.name, event.giftName, addedLikes, racer.speed))
		end
	end
end

local function handleEvent(event)
	if event.type == "player_joined" then
		local source = event.player.source
		if source then
			print(string.format(
				"%s está na fila; ainda não está na corrida. Origem: comentário #%s de @%s: %q (TikTok msg %s).",
				event.player.name,
				tostring(source.commentId),
				source.tiktokUsername,
				source.text,
				source.tiktokMessageId ~= "" and source.tiktokMessageId or "sem ID"
			))
		else
			print(event.player.name .. " está na fila para a próxima corrida.")
		end
	elseif event.type == "betting_open" then
		print(string.format("Apostas abertas para a corrida %d.", event.raceId))
	elseif event.type == "race_started" then
		task.spawn(function()
			local ok, err = pcall(runRace, event)
			if not ok then
				activeRace = nil
				raceRunning = false
				warn("Erro durante a corrida: " .. tostring(err))
			end
		end)
	elseif event.type == "racer_joined" then
		if activeRace and activeRace.id == event.raceId then
			addRacerToRace(activeRace, event.player)
		end
	elseif event.type == "race_finished" then
		print(string.format("%s venceu! As apostas virtuais foram liquidadas.", event.winner.name))
		task.wait(5)
		for _, car in pairs(carsById) do
			car:Destroy()
		end
		carsById = {}
		laneById = {}
		nextLane = 0
	elseif event.type == "gift_effect" then
		applyGiftAction(event)
	elseif event.type == "like_boost" then
		applyLikeBoost(event)
	elseif event.type == "connection_test" then
		local ok, err = pcall(function()
			request("/roblox/test-ack", "POST", { testId = event.testId })
		end)
		if not ok then
			error("Não foi possível confirmar o teste de conexão: " .. tostring(err))
		end
		print("Teste de conexão TOKBLOX recebido e confirmado pelo gateway.")
	end
end

createTrack()

while true do
	local ok, result = pcall(function()
		return request("/roblox/events?after=" .. cursor, "GET")
	end)
	if ok then
		for _, event in ipairs(result.events) do
			cursor = math.max(cursor, event.id)
			local eventOk, eventError = pcall(handleEvent, event)
			if not eventOk then
				warn(string.format("Erro no evento %d (%s): %s", event.id, event.type, tostring(eventError)))
			end
		end
	else
		warn("Falha ao consultar o gateway de live: " .. tostring(result))
	end
	task.wait(POLL_SECONDS)
end

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local Debris = game:GetService("Debris")
local Workspace = game:GetService("Workspace")

local API_BASE_URL = "https://tokblox.onrender.com"
local API_KEY = "COLOQUE_A_MESMA_CHAVE_DO_ROBLOX_API_KEY"
local POLL_SECONDS = 2
local TRACK_LENGTH = 300
local RACE_JOIN_WINDOW_SECONDS = 30
local MAX_RACERS = 8

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
	table.insert(race.racers, {
		player = player,
		car = car,
		start = start,
		speed = math.random(70, 110),
		startedAt = os.clock(),
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
	local winner
	repeat
		local now = os.clock()
		local allRacersFinished = true
		local winningFinishTime = math.huge

		for _, racer in ipairs(activeRace.racers) do
			local elapsed = math.max(0, now - racer.startedAt)
			local finishTime = racer.startedAt + TRACK_LENGTH / racer.speed
			local distance = math.min(racer.speed * elapsed, TRACK_LENGTH)
			racer.car:PivotTo(racer.start * CFrame.new(0, 0, -distance))
			if now < finishTime then
				allRacersFinished = false
			end
			if finishTime < winningFinishTime then
				winner = racer.player
				winningFinishTime = finishTime
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

local function showGiftEffect(event)
	for _, car in pairs(carsById) do
		local chassis = car.PrimaryPart
		if chassis then
			if event.effect == "confetti" then
				local attachment = Instance.new("Attachment")
				attachment.Parent = chassis
				local confetti = Instance.new("ParticleEmitter")
				confetti.Texture = "rbxasset://textures/particles/sparkles_main.dds"
				confetti.Color = ColorSequence.new(Color3.fromRGB(197, 243, 107), Color3.fromRGB(242, 89, 178))
				confetti.Lifetime = NumberRange.new(0.8, 1.5)
				confetti.Speed = NumberRange.new(8, 16)
				confetti.SpreadAngle = Vector2.new(180, 180)
				confetti.Parent = attachment
				confetti:Emit(math.min(event.count * 8, 80))
				Debris:AddItem(attachment, 2)
			elseif event.effect == "neon" then
				local highlight = Instance.new("Highlight")
				highlight.Adornee = car
				highlight.FillColor = Color3.fromRGB(197, 243, 107)
				highlight.OutlineColor = Color3.fromRGB(242, 89, 178)
				highlight.FillTransparency = 0.35
				highlight.Parent = car
				Debris:AddItem(highlight, 3)
			elseif event.effect == "celebration" then
				local billboard = Instance.new("BillboardGui")
				billboard.Adornee = chassis
				billboard.Size = UDim2.fromOffset(240, 48)
				billboard.StudsOffset = Vector3.new(0, 6, 0)
				billboard.AlwaysOnTop = true
				billboard.Parent = car
				local text = Instance.new("TextLabel")
				text.Size = UDim2.fromScale(1, 1)
				text.BackgroundTransparency = 1
				text.TextColor3 = Color3.fromRGB(197, 243, 107)
				text.TextStrokeTransparency = 0.2
				text.Font = Enum.Font.GothamBold
				text.TextScaled = true
				text.Text = "OBRIGADO, " .. string.upper(event.sender) .. "!"
				text.Parent = billboard
				Debris:AddItem(billboard, 3)
			end
		end
	end
	print(string.format("Presente %s de %s acionou %s.", event.giftName, event.sender, event.effect))
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
		showGiftEffect(event)
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

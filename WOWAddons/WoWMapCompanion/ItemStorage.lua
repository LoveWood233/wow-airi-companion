-- Container revisions are independent of acquisition notices. Closed banks retain dated observations, never an empty replacement.
local _, ns = ...
local Storage = {}
ns.ItemStorage = Storage
local owner, database, active, bankOpen, timer, worker
local revision, signatures, pending, queued = 0, {}, {}, {}
local retries = {}
local Public = ns.Protocol.Public

local function Read(fn, ...)
    if type(fn) ~= "function" then return nil, false end
    local ok, value = pcall(fn, ...)
    if not ok or (issecretvalue and issecretvalue(value)) then return nil, false end
    value = Public(value)
    if type(value) == "table" and canaccesstable then
        local readable, allowed = pcall(canaccesstable, value)
        if not readable or Public(allowed) ~= true then return nil, false end
    end
    return value, true
end

local function Integer(value, low, high)
    value = Public(value)
    if type(value) == "number" and value == value and value >= low and value <= high and value == math.floor(value) then return value end
end

local function Current()
    local guid = Read(UnitGUID, "player")
    return active and owner and owner.guid ~= "" and owner.guid == guid
end

local function Key(scope, container) return scope .. ":" .. container end

local function ContainerAPI(name)
    return C_Container and C_Container[name] or _G[name]
end

local function ContainerInfo(container, slot)
    if C_Container and type(C_Container.GetContainerItemInfo) == "function" then
        return Read(C_Container.GetContainerItemInfo, container, slot)
    end
    if type(GetContainerItemInfo) ~= "function" then return nil, false end
    local result = { pcall(GetContainerItemInfo, container, slot) }
    if not result[1] then return nil, false end
    for index = 2, 12 do
        if issecretvalue and issecretvalue(result[index]) then return nil, false end
        result[index] = Public(result[index])
    end
    if result[2] == nil and result[3] == nil and result[8] == nil then return nil, true end
    return { stackCount = result[3], hyperlink = result[8], itemID = result[11] }, true
end

local function Queue(scope, container, attempts)
    container = Integer(container, -10, 1000)
    if not container then return end
    local key = Key(scope, container)
    if not queued[key] and #pending < 40 then
        queued[key] = true
        pending[#pending + 1] = { scope = scope, container = container, key = key, attempts = attempts or 0 }
    end
end

local function BankReadable(scope)
    if not bankOpen then return false end
    local kinds = Enum and Enum.BankType
    local kind = kinds and (scope == "account-bank" and kinds.Account or kinds.Character)
    if C_Bank and C_Bank.CanViewBank and kind ~= nil then
        return Read(C_Bank.CanViewBank, kind) == true
    end
    -- Published clients without tab APIs expose the legacy bank only while its frame is open.
    return scope == "bank" and not (C_Bank and C_Bank.FetchPurchasedBankTabIDs)
end

local function Retry(descriptor)
    if descriptor.attempts >= 4 or retries[descriptor.key] then return end
    local session, guid = owner.session, owner.guid
    retries[descriptor.key] = C_Timer.NewTimer(0.5 * (descriptor.attempts + 1), function()
        retries[descriptor.key] = nil
        if Current() and owner.session == session and owner.guid == guid
            and (descriptor.scope == "bags" or BankReadable(descriptor.scope)) then
            Queue(descriptor.scope, descriptor.container, descriptor.attempts + 1)
            Storage.Tick()
        end
    end)
end

local function Discover()
    if not Current() then return end
    local last = Integer(NUM_TOTAL_EQUIPPED_BAG_SLOTS, 0, 20) or Integer(NUM_BAG_SLOTS, 0, 20)
    if last then for bag = 0, last do Queue("bags", bag) end end
    local reagent = Enum and Enum.BagIndex and Integer(Enum.BagIndex.ReagentBag, 0, 20)
    if reagent and (not last or reagent > last) then Queue("bags", reagent) end
    if not bankOpen then return end
    local kinds = Enum and Enum.BankType
    if C_Bank and type(C_Bank.FetchPurchasedBankTabIDs) == "function" and kinds then
        for _, descriptor in ipairs({ { "bank", kinds.Character }, { "account-bank", kinds.Account } }) do
            if descriptor[2] ~= nil and BankReadable(descriptor[1]) then
                local ids, readable = Read(C_Bank.FetchPurchasedBankTabIDs, descriptor[2])
                if readable and type(ids) == "table" then
                    for _, id in ipairs(ids) do Queue(descriptor[1], id) end
                end
            end
        end
    elseif BankReadable("bank") then
        local bank = Integer(BANK_CONTAINER, -10, -1)
        if bank then Queue("bank", bank) end
        local bags = Integer(NUM_BANKBAGSLOTS, 0, 20)
        if last and bags then for bag = last + 1, last + bags do Queue("bank", bag) end end
        if Read(IsReagentBankUnlocked) == true then Queue("bank", REAGENTBANK_CONTAINER) end
    end
end

local function Save(record)
    local key = Key(record.scope, record.container)
    -- Identity and capture time do not invalidate otherwise unchanged contents.
    local signature = ns.Transfer.StorageSlotsJSON(record)
    if signatures[key] == signature then return end
    if ns.Transfer.SetStorage(record) then
        signatures[key] = signature
        local saved = database.itemStorage.characters[record.guid]
        if type(saved) ~= "table" then saved = {}; database.itemStorage.characters[record.guid] = saved end
        saved[key] = record
    end
end

local function Capture(descriptor)
    if not Current() then return end
    if descriptor.scope ~= "bags" and not BankReadable(descriptor.scope) then Storage.Tick(); return end
    local capacity = Integer(Read(ContainerAPI("GetContainerNumSlots"), descriptor.container), 0, 200)
    if not capacity or (capacity == 0 and (descriptor.scope ~= "bags" or descriptor.container == 0)) then
        Retry(descriptor)
        Storage.Tick()
        return
    end
    local observedAt = Integer(Read(GetServerTime), 1, 4102444800)
    if not observedAt then return end
    local session, guid = owner.session, owner.guid
    local record = { v = 2, id = 1, session = session, guid = guid, observedAt = observedAt,
        scope = descriptor.scope, container = descriptor.container, capacity = capacity, complete = true, cached = false, slots = {} }
    local index, needsRetry = 1, false
    local function Step()
        worker = nil
        if not Current() or owner.session ~= session or owner.guid ~= guid
            or (descriptor.scope ~= "bags" and not BankReadable(descriptor.scope)) then
            if Storage.current == descriptor then Storage.current = nil end
            Storage.Tick()
            return
        end
        local finish = math.min(capacity, index + 7)
        while index <= finish do
            local info, readable = ContainerInfo(descriptor.container, index)
            local entry = { slot = index, state = "unknown", quantity = 0 }
            if readable and info == nil then entry.state = "empty"
            elseif readable and type(info) == "table" then
                local quantity = Integer(info.stackCount, 1, 1000000)
                local item = quantity and ns.Equipment.DescribeContainerItem(descriptor.container, index, info, observedAt)
                if item then entry.state, entry.quantity, entry.item = "occupied", quantity, item end
                if not item or not item.infoComplete or (not item.truncated and (not item.statsComplete or not item.tooltipComplete)) then
                    needsRetry = true
                    local identifier = Integer(info.itemID, 1, 2147483647)
                    if identifier then Read(C_Item and C_Item.RequestLoadItemDataByID, identifier) end
                end
            end
            if entry.state == "unknown" then record.complete, needsRetry = false, true end
            record.slots[#record.slots + 1] = entry
            index = index + 1
        end
        if index <= capacity then worker = C_Timer.NewTimer(0.02, Step)
        else
            if Storage.current == descriptor then Storage.current = nil end
            -- A multi-tick scan invalidated by a bag event must not publish a mixed revision.
            if not descriptor.invalid then
                revision = revision + 1
                record.id = revision
                Save(record)
                if needsRetry then Retry(descriptor) end
                if not needsRetry and retries[descriptor.key] then retries[descriptor.key]:Cancel(); retries[descriptor.key] = nil end
            end
            Storage.Tick()
        end
    end
    descriptor.inFlight = true
    Storage.current = descriptor
    Step()
end

function Storage.Initialize(state, db)
    owner, database = state, db
    if type(db.itemStorage) ~= "table" or db.itemStorage.version ~= 1 then db.itemStorage = { version = 1, characters = {} } end
    local account = db.money and Public(db.money.account)
    if type(account) == "string" and db.itemStorage.account ~= account then
        db.itemStorage = { version = 1, account = account, characters = {} }
    end
    if type(db.itemStorage.characters) ~= "table" then db.itemStorage.characters = {} end
end

function Storage.Tick()
    if not Current() or worker or timer then return end
    local descriptor = table.remove(pending, 1)
    if descriptor then
        queued[descriptor.key] = nil
        timer = C_Timer.NewTimer(0.05, function() timer = nil; Capture(descriptor) end)
    end
end

function Storage.OnEvent(event)
    if event == "PLAYER_ENTERING_WORLD" then
        active, bankOpen = true, false
        if timer then timer:Cancel() end
        timer = C_Timer.NewTimer(0.4, function()
            timer = nil
            if not Current() then return end
            if owner and database and database.itemStorage then
                local saved = database.itemStorage.characters[owner.guid]
                if type(saved) == "table" then
                    local count = 0
                    for _, old in pairs(saved) do
                        if count >= 40 then break end
                        if type(old) == "table" and old.guid == owner.guid and old.scope ~= "bags" then
                            revision = revision + 1
                            local record = {}
                            for key, value in pairs(old) do record[key] = value end
                            record.id, record.session, record.cached = revision, owner.session, true
                            pcall(ns.Transfer.SetStorage, record)
                            count = count + 1
                        end
                    end
                end
            end
            Discover()
            Storage.Tick()
        end)
        return
    elseif event == "PLAYER_LEAVING_WORLD" or event == "PLAYER_LOGOUT" then
        active, bankOpen = false, false
        if timer then timer:Cancel(); timer = nil end
        if worker then worker:Cancel(); worker = nil end
        for _, retry in pairs(retries) do retry:Cancel() end
        retries, Storage.current = {}, nil
        pending, queued, signatures = {}, {}, {}
        ns.Transfer.ClearStorage()
        return
    elseif event == "BANKFRAME_OPENED" then
        bankOpen = true
        for key in pairs(signatures) do if not string.match(key, "^bags:") then signatures[key] = nil end end
        Discover()
    elseif event == "BANKFRAME_CLOSED" then
        bankOpen = false
        local carried = {}
        for _, descriptor in ipairs(pending) do
            if descriptor.scope == "bags" then carried[#carried + 1] = descriptor
            else queued[descriptor.key] = nil end
        end
        pending = carried
        if Storage.current and Storage.current.scope ~= "bags" then
            if worker then worker:Cancel(); worker = nil end
            Storage.current = nil
        end
    elseif event == "BAG_UPDATE_DELAYED" or event == "PLAYERBANKSLOTS_CHANGED" or event == "PLAYERREAGENTBANKSLOTS_CHANGED"
        or event == "BANK_TABS_CHANGED" or event == "PLAYER_ACCOUNT_BANK_TAB_SLOTS_CHANGED" or event == "GET_ITEM_INFO_RECEIVED" or event == "ITEM_DATA_LOAD_RESULT" then
        if Storage.current and event ~= "GET_ITEM_INFO_RECEIVED" and event ~= "ITEM_DATA_LOAD_RESULT" then Storage.current.invalid = true end
        Discover()
    end
    Storage.Tick()
end

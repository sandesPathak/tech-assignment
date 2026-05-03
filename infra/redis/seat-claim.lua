-- seat-claim.lua — atomic seat reservation for the Hijack Poker lobby.
--
-- Loaded once at gateway boot via SCRIPT LOAD; invoked through EVALSHA on
-- every claim. Determinism is guaranteed because all reads/writes target
-- one Redis instance and Redis runs scripts single-threaded.
--
-- KEYS:
--   [1] seatsKey   = "table:{id}:seats"          HASH seat -> "userId|token|expiresAtMs"
--   [2] tableKey   = "lobby:{stake}:tables"      ZSET  tableId -> openSeatCount  (sorted by open seats, ascending)
--   [3] metaKey    = "table:{id}:meta"           HASH metadata (stake, lastActivityMs, maxSeats, etc.)
--   [4] eventsKey  = "lobby:{stake}:events"      pub/sub channel name (stored as plain string key for ARGV pickup;
--                                                we PUBLISH against this channel name string).
--
-- ARGV:
--   [1] tableId
--   [2] seat                   integer 1..maxSeats
--   [3] userId
--   [4] reservationToken       caller-supplied opaque token (idempotency key)
--   [5] ttlMs                  reservation TTL in ms
--   [6] nowMs                  caller-supplied monotonic-ish time
--
-- Returns:
--   {1, expiresAtMs, openSeatsAfter}   on success (claimed OR idempotent re-claim)
--   {0, "taken"}                       seat held by a different user with unexpired reservation
--   {0, "no_table"}                    table meta does not exist
--   {0, "bad_seat"}                    seat number out of range / not in maxSeats

local seatsKey  = KEYS[1]
local tableKey  = KEYS[2]
local metaKey   = KEYS[3]
local eventsCh  = KEYS[4]

local tableId        = ARGV[1]
local seat           = tonumber(ARGV[2])
local userId         = ARGV[3]
local token          = ARGV[4]
local ttlMs          = tonumber(ARGV[5])
local nowMs          = tonumber(ARGV[6])

-- Validate table exists (matchmaker must have provisioned meta first).
local maxSeatsRaw = redis.call('HGET', metaKey, 'maxSeats')
if not maxSeatsRaw then
  return {0, 'no_table'}
end
local maxSeats = tonumber(maxSeatsRaw)
if not seat or seat < 1 or seat > maxSeats then
  return {0, 'bad_seat'}
end

local seatField = tostring(seat)
local existing = redis.call('HGET', seatsKey, seatField)

local expiresAtMs = nowMs + ttlMs
local writeValue = userId .. '|' .. token .. '|' .. tostring(expiresAtMs)

local claimed = false
if not existing or existing == '' then
  claimed = true
else
  -- Parse "userId|token|expiresAtMs"
  local p1 = string.find(existing, '|', 1, true)
  local p2 = p1 and string.find(existing, '|', p1 + 1, true) or nil
  if p1 and p2 then
    local exUser  = string.sub(existing, 1, p1 - 1)
    local exToken = string.sub(existing, p1 + 1, p2 - 1)
    local exExp   = tonumber(string.sub(existing, p2 + 1)) or 0
    if exUser == userId then
      -- Same user re-claiming this seat — page refresh, reconnect, or
      -- handoff. Always succeed (refresh TTL, mint new token). Without
      -- this, a user who reloads gets locked out of their own seat for
      -- the remaining TTL while the engine still has them as a player,
      -- so the UI ends up showing them seated with no action bar.
      claimed = true
    elseif exExp <= nowMs then
      -- Reservation lapsed; another user can reclaim.
      claimed = true
    else
      return {0, 'taken'}
    end
  else
    -- Malformed entry -> treat as empty.
    claimed = true
  end
end

if not claimed then
  return {0, 'taken'}
end

redis.call('HSET', seatsKey, seatField, writeValue)

-- Recompute open seat count from the seats hash (single source of truth).
local takenCount = 0
local all = redis.call('HGETALL', seatsKey)
local i = 1
while i <= #all do
  local v = all[i + 1]
  if v and v ~= '' then
    -- Count active OR same-user idempotent reservations as taken; expired
    -- entries are zeroed lazily on the next claim or matchmaker scan.
    local pp1 = string.find(v, '|', 1, true)
    local pp2 = pp1 and string.find(v, '|', pp1 + 1, true) or nil
    local vexp = (pp1 and pp2) and (tonumber(string.sub(v, pp2 + 1)) or 0) or 0
    if vexp > nowMs then
      takenCount = takenCount + 1
    end
  end
  i = i + 2
end
local openSeats = maxSeats - takenCount

-- Update lobby ZSET so matchmaker / lobby readers see the new open count.
redis.call('ZADD', tableKey, openSeats, tableId)

-- Track last activity for the idle-cleanup TTL.
redis.call('HSET', metaKey, 'lastActivityMs', tostring(nowMs))

-- Publish a lobby delta — gateways subscribed to "lobby:{stake}:events"
-- forward this to all lobby viewers.
local payload = string.format(
  '{"t":"seat_filled","tableId":"%s","seat":%d,"openSeats":%d,"maxSeats":%d}',
  tableId, seat, openSeats, maxSeats
)
redis.call('PUBLISH', eventsCh, payload)

return {1, tostring(expiresAtMs), tostring(openSeats)}

-- Devre kesici (021 §5.11): tek atomik EVALSHA, replikalar arası ortak durum.
-- KEYS[1] = eda:brk:<kaynak>  hash: state (closed|open|half_open), opened_at, open_ms, fails (ardışık),
--           ws, n, e (pencere başı, istek, hata), probe (yarı açık deneme başlangıcı; 0 = yok), reason
-- ARGV[1] = işlem: allow | success | failure | waf | release | peek
-- ARGV[2] = now; ARGV[3] windowMs; ARGV[4] errorRatePct; ARGV[5] minRequests; ARGV[6] consecutiveFailures;
-- ARGV[7] openMs; ARGV[8] openMaxMs; ARGV[9] wafOpenMs; ARGV[10] reason (failure)
-- allow dönüşü {1, 0} | {0, kalan_ms (-1 = bilinmiyor)}; peek dönüşü {state, open_until (-1 = yok), reason}
-- Değerler yalnız durum, sayı ve sabit neden kodudur (Y-41).

local key = KEYS[1]
local op = ARGV[1]
local now = tonumber(ARGV[2])
local windowMs = tonumber(ARGV[3])
local ratePct = tonumber(ARGV[4])
local minReq = tonumber(ARGV[5])
local consecutive = tonumber(ARGV[6])
local openMs = tonumber(ARGV[7])
local openMaxMs = tonumber(ARGV[8])
local wafOpenMs = tonumber(ARGV[9])

local function num(v, default)
  local n = tonumber(v)
  if n == nil then return default end
  return n
end

local v = redis.call('HMGET', key, 'state', 'opened_at', 'open_ms', 'fails', 'ws', 'n', 'e', 'probe', 'reason')
local s = {
  state = v[1] or 'closed',
  opened_at = num(v[2], 0),
  open_ms = num(v[3], openMs),
  fails = num(v[4], 0),
  ws = num(v[5], now),
  n = num(v[6], 0),
  e = num(v[7], 0),
  probe = num(v[8], 0),
  reason = v[9] or '',
}

local function save()
  redis.call('HSET', key, 'state', s.state, 'opened_at', s.opened_at, 'open_ms', s.open_ms,
    'fails', s.fails, 'ws', s.ws, 'n', s.n, 'e', s.e, 'probe', s.probe, 'reason', s.reason)
end

local function open(ms)
  s.state = 'open'
  s.opened_at = now
  s.open_ms = ms
  s.probe = 0
end

-- Sabit pencere: breaker.windowMs dolunca sayaçlar sıfırlanır.
local function push(ok)
  if now - s.ws >= windowMs then
    s.ws = now
    s.n = 0
    s.e = 0
  end
  s.n = s.n + 1
  if not ok then s.e = s.e + 1 end
end

if op == 'peek' then
  local state = s.state
  local untilMs = -1
  if state == 'open' then
    untilMs = s.opened_at + s.open_ms
    if now >= untilMs then state = 'half_open' end
  end
  return { state, untilMs, s.reason }
end

if op == 'allow' then
  if s.state == 'open' then
    local left = s.opened_at + s.open_ms - now
    if left > 0 then return { 0, left } end
    s.state = 'half_open'
    s.probe = 0
  end
  if s.state == 'half_open' then
    -- Deneme isteği yarıda kalan replikada takılmasın: open_ms sonra yeni deneme serbest.
    if s.probe > 0 and now - s.probe < s.open_ms then
      save()
      return { 0, -1 }
    end
    s.probe = now
  end
  save()
  return { 1, 0 }
end

if op == 'success' then
  push(true)
  s.fails = 0
  if s.state == 'half_open' then
    s.state = 'closed'
    s.open_ms = openMs
    s.probe = 0
  end
  save()
  return 1
end

if op == 'failure' then
  push(false)
  s.fails = s.fails + 1
  s.reason = ARGV[10] or 'network'
  if s.state == 'half_open' then
    open(math.min(s.open_ms * 2, openMaxMs))
  else
    local rateTrip = s.n >= minReq and (s.e * 100) / s.n >= ratePct
    if s.fails >= consecutive or rateTrip then open(openMs) end
  end
  save()
  return 1
end

if op == 'waf' then
  s.reason = 'waf_blocked'
  open(wafOpenMs)
  save()
  return 1
end

if op == 'release' then
  if s.state == 'half_open' then
    s.probe = 0
    save()
  end
  return 1
end

return redis.error_reply('ERR eda: bilinmeyen islem')

-- Kaynak token kovası ve öncelik sınıfları (021 §5.10): tek atomik EVALSHA. Zaman çağırandan gelir
-- (testte sahte saat); script içinde TIME kullanılmaz.
-- KEYS[1] = eda:tb:source:<kova>   hash: tokens, ts, pu (429 cezası bitişi)
-- KEYS[2..4] = eda:lq:interactive | eda:lq:verify | eda:lq:ingest   hash: g, d, w, ws
-- ARGV[1] = işlem: take | penalize | done | peek
--   take:     ARGV[2] now, [3] interval, [4] sınıf, [5] maxWait, [6] sharePct, [7] windowMs
--             dönüş {1, bekleme_ms} | {0, retry_ms, tür}  (tür 1 = 429 cezası, 2 = meşgul)
--   penalize: ARGV[2] now, [3] interval, [4] bitiş (pu adayı)          dönüş 1
--   done:     ARGV[2] sınıf (bekleme bitti: w -= 1, 0'ın altına inmez)  dönüş 1
--   peek:     ARGV[2] now, [3] interval, [4] windowMs
--             dönüş {tokens (dize), pu, w_interactive, w_verify, w_ingest}
-- Değerler yalnız sayı ve sabit sınıf adıdır; sorgu veya içerik yazılmaz (Y-41).

local op = ARGV[1]
local tb = KEYS[1]
local lq = { interactive = KEYS[2], verify = KEYS[3], ingest = KEYS[4] }

local function num(v, default)
  local n = tonumber(v)
  if n == nil then return default end
  return n
end

-- Sınıf sayacı: pencere dolduysa g ve d sıfırlanır (w bekleyen sayısıdır, pencereyle sıfırlanmaz).
local function counters(cls, now, win)
  local key = lq[cls]
  local v = redis.call('HMGET', key, 'g', 'd', 'w', 'ws')
  local ws = tonumber(v[4])
  local c = { g = num(v[1], 0), d = num(v[2], 0), w = math.max(0, num(v[3], 0)) }
  if ws == nil or now - ws >= win then
    c.g = 0
    c.d = 0
    redis.call('HSET', key, 'g', 0, 'd', 0, 'w', c.w, 'ws', now)
    redis.call('PEXPIRE', key, 2 * win)
  end
  return c
end

local function bump(cls, field, win)
  redis.call('HINCRBY', lq[cls], field, 1)
  redis.call('PEXPIRE', lq[cls], 2 * win)
end

local function bucket(now, interval)
  local v = redis.call('HMGET', tb, 'tokens', 'ts', 'pu')
  local tokens = num(v[1], 1)
  local ts = num(v[2], now)
  local pu = num(v[3], 0)
  tokens = math.min(1, tokens + math.max(0, now - ts) / interval)
  return tokens, pu
end

-- Anahtar, kova tamamen dolup ceza bitene dek tutulur; sonra yokluğu "dolu kova" demektir.
local function save(now, interval, tokens, pu)
  redis.call('HSET', tb, 'tokens', tokens, 'ts', now, 'pu', pu)
  local keep = math.max((1 - tokens) * interval, pu - now, 0) + interval
  redis.call('PEXPIRE', tb, math.ceil(keep))
end

if op == 'take' then
  local now = tonumber(ARGV[2])
  local interval = tonumber(ARGV[3])
  local cls = ARGV[4]
  local maxWait = tonumber(ARGV[5])
  local share = tonumber(ARGV[6])
  local win = tonumber(ARGV[7])
  if lq[cls] == nil then return redis.error_reply('ERR eda: bilinmeyen sinif') end

  -- 1. 429 cezası
  local tokens, pu = bucket(now, interval)
  if pu > now then return { 0, math.ceil(pu - now), 1 } end

  -- 2. dolum (bucket() içinde); 3. çekişme
  local ci = counters('interactive', now, win)
  local cv = counters('verify', now, win)
  local cg = counters('ingest', now, win)
  local contention = (cv.d + cg.d) > 0
  local wait = (1 - tokens) * interval

  if cls == 'interactive' then
    -- 4. çekişme varken interactive payı sharePct'e ulaştıysa rezervasyon yasak
    local total = ci.g + cv.g + cg.g
    local capped = contention and total > 0 and (ci.g / total) >= (share / 100)
    if tokens >= 1 then
      save(now, interval, tokens - 1, pu)
      bump(cls, 'g', win)
      return { 1, 0 }
    end
    if (not capped) and wait <= maxWait then
      save(now, interval, tokens - 1, pu)
      bump(cls, 'g', win)
      bump(cls, 'w', win)
      return { 1, math.ceil(wait) }
    end
    save(now, interval, tokens, pu)
    bump(cls, 'd', win)
    return { 0, math.ceil(wait), 2 }
  end

  if cls == 'ingest' and cv.d > 0 then
    -- 6. verify reddedilmişse ingest token alamaz; verify sayaçlarının penceresi bitene dek
    save(now, interval, tokens, pu)
    bump(cls, 'd', win)
    local ws = num(redis.call('HMGET', lq.verify, 'ws')[1], now)
    return { 0, math.max(math.ceil(wait), math.ceil(ws + win - now)), 2 }
  end

  -- 5. verify / 6. ingest: beklemez
  if tokens >= 1 then
    save(now, interval, tokens - 1, pu)
    bump(cls, 'g', win)
    return { 1, 0 }
  end
  save(now, interval, tokens, pu)
  bump(cls, 'd', win)
  return { 0, math.ceil(wait), 2 }
end

if op == 'penalize' then
  local now = tonumber(ARGV[2])
  local interval = tonumber(ARGV[3])
  local tokens, pu = bucket(now, interval)
  save(now, interval, tokens, math.max(pu, tonumber(ARGV[4])))
  return 1
end

if op == 'done' then
  local key = lq[ARGV[2]]
  if key == nil then return redis.error_reply('ERR eda: bilinmeyen sinif') end
  local w = num(redis.call('HMGET', key, 'w')[1], 0)
  if w > 0 then redis.call('HINCRBY', key, 'w', -1) end
  return 1
end

if op == 'peek' then
  local now = tonumber(ARGV[2])
  local interval = tonumber(ARGV[3])
  local tokens, pu = bucket(now, interval)
  local w = {}
  for i, cls in ipairs({ 'interactive', 'verify', 'ingest' }) do
    w[i] = math.max(0, num(redis.call('HMGET', lq[cls], 'w')[1], 0))
  end
  return { tostring(tokens), pu, w[1], w[2], w[3] }
end

return redis.error_reply('ERR eda: bilinmeyen islem')

-- Tek uçuş kilidini yalnız sahibi bırakır (021 §5.9): KEYS[1] = eda:sf:<sha256>, ARGV[1] = rastgele belirteç.
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0

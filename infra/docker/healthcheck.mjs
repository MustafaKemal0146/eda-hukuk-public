// Konteynır sağlık denetimi (014 §6.1): verilen URL'ye GET, 2 sn zaman aşımı, 2xx → 0, aksi 1.
const url = process.argv[2];
if (!url) process.exit(2);
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}

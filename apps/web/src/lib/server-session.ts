// Sunucu tarafı oturum varlığı denetimi (yalnız `GET`): çerez api'ye iletilir, yanıt önbelleğe alınmaz.
// Yönlendirme yalnız kolaylıktır; yetki kararını api verir (050 §7).
import { cookies } from 'next/headers';
import { readApiInternalUrl } from '../config/env.ts';

export async function hasSession(): Promise<boolean> {
  const base = readApiInternalUrl();
  if (!base) return false;
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  if (header === '') return false;
  try {
    const res = await fetch(`${base}/api/v1/me`, {
      headers: { cookie: header },
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

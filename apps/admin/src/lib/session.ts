// Sunucu tarafı yönetim oturumu (yalnız `GET /api/v1/admin/me`): çerez api'ye iletilir, yanıt
// önbelleğe alınmaz. Yönlendirme kolaylıktır; veriyi koruyan katman api'dir (`platformGate`).
import { AdminMeDto, type AdminMeDtoValue } from '@eda/contracts/api/admin';
import { cookies } from 'next/headers';
import { readApiInternalUrl } from '../config/env.ts';

export async function getAdminMe(): Promise<AdminMeDtoValue | null> {
  const base = readApiInternalUrl();
  if (!base) return null;
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  if (header === '') return null;
  try {
    const res = await fetch(`${base}/api/v1/admin/me`, {
      headers: { cookie: header },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return AdminMeDto.parse(await res.json());
  } catch {
    return null;
  }
}

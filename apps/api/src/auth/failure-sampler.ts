// `auth.login.failure` denetim örneklemesi (042 §13): IP başına dakikalık üst sınır
// (`audit.loginFailureSamplePerIpPerMin`). Uygulama ve yönetim kimliği aynı kuralı kullanır.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';

export function createFailureSampler(now: () => Date): (ip: string) => boolean {
  const sampler = new Map<string, { minute: number; n: number }>();
  return (ip) => {
    const minute = Math.floor(now().getTime() / 60_000);
    const cur = sampler.get(ip);
    if (cur === undefined || cur.minute !== minute) {
      if (sampler.size > 10_000) sampler.clear();
      sampler.set(ip, { minute, n: 1 });
      return true;
    }
    cur.n += 1;
    return cur.n <= CONFIG_DEFAULTS['audit.loginFailureSamplePerIpPerMin'];
  };
}

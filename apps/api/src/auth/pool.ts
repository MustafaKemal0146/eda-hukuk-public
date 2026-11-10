// `authDb` havuzunun kapatılması (040 §12.2): yalnız bu dizin `@eda/db/auth`'a erişir.
import { closeAuthDb } from '@eda/db/auth';

export function closeAuthDbPool(): Promise<void> {
  return closeAuthDb();
}

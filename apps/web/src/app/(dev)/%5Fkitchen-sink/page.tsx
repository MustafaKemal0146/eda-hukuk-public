// /_kitchen-sink: yalnız EDA_ENV=development iken görünür (KK-013-10). Vitrin modülü yalnız bu
// koşulda dinamik içe aktarılır; diğer ortamlarda notFound().
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { readEdaEnv } from '../../../config/env.ts';
import { isKitchenSinkEnabled } from '../../../features/shell/kitchen-sink/enabled.ts';

export default async function KitchenSinkPage() {
  await connection();
  if (!isKitchenSinkEnabled(readEdaEnv())) notFound();
  const { KitchenSink } = await import('../../../features/shell/kitchen-sink/kitchen-sink.tsx');
  return <KitchenSink />;
}

// Seed tanımı (032 §10.1): ad (`public.seed_runs.seed_name`), içerik (özetlenir; değişmediyse atlanır)
// ve yazıcı. Yazıcı yalnız eşleme + upsert yapar; dış çağrı (model, S3, ağ) YOK.
import type { ClientBase } from 'pg';
import type { DevStage } from './profile.ts';
import type { SeedCounts } from './upsert.ts';

export interface SeedDef {
  readonly name: string;
  /** `prod` seed'i her profilde koşar; dev aşamaları yalnız `devStagesFor` döndürdüğünde. */
  readonly stage: 'prod' | DevStage;
  /** İçerik özeti girdisi (kanonik JSON'a çevrilip SHA-256 alınır). */
  readonly content: unknown;
  apply(q: ClientBase): Promise<SeedCounts>;
}

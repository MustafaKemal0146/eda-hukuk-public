// `@eda/editor` başsız belge çekirdeği (054 §1.1). Alt yollar (`./schema`, `./validate`, `./hash`,
// `./diff`, `./docast`) tercih edilir; bu giriş sunucu tarafı kolaylığı içindir.
export { blockDiff, inlineDiff } from './diff/index.ts';
export { DocAstError, fromDocAst, toDocAst } from './docast/index.ts';
export { blockDigest, canonicalJson, docHash, stripRev } from './hash/canonical.ts';
export {
  buildEditorExtensions,
  getEditorSchema,
  isBlockId,
  newBlockId,
  parseDocJson,
  parseSectionJson,
  sanitizeText,
} from './schema/index.ts';
export {
  checkElements,
  hasErrors,
  schemaInvalidReason,
  validateDoc,
  validateDocJson,
  validateSection,
} from './validate/index.ts';

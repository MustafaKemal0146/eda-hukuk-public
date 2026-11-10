// `@eda/contracts/errors` genel yüzü (044 §2.3). Adlandırılmış yeniden dışa aktarımlar.
export { ERROR_ACTIONS, type ErrorAction } from './actions.ts';
export {
  AppError,
  AppErrorContractError,
  type AppErrorMeta,
  type AppErrorOptions,
  errorMessageTr,
  httpStatusOf,
  toEnvelope,
} from './app-error.ts';
export {
  type ActionOf,
  type CatalogEntry,
  ERROR_CATALOG,
  ERROR_HTTP_STATUSES,
  ERROR_META_KEYS,
  ERROR_RETRY_CLASSES,
  ERROR_SURFACES,
  type ErrorHttpStatus,
  type ErrorMetaKey,
  type ErrorRetryClass,
  type ErrorSpec,
  type ErrorSurface,
  type MetaKeyOf,
  type ReasonOf,
} from './catalog.ts';
export { ERROR_CODE_PATTERN, ERROR_CODES, type ErrorCode, isErrorCode } from './codes.ts';
export {
  ApiErrorEnvelope,
  AuthErrorBody,
  ERROR_FIELD_ISSUES,
  ERROR_FIELDS_MAX,
  ERROR_REASON_PATTERN,
  ErrorField,
  type ErrorFieldIssue,
  ErrorMetaValue,
  fieldIssueOf,
  StreamErrorMeta,
} from './envelope.ts';
export { ERROR_MESSAGES_TR, type ErrorMessageEntry } from './messages.tr.ts';
export { ERROR_PREFIXES, type ErrorPrefix, prefixOf } from './prefixes.ts';

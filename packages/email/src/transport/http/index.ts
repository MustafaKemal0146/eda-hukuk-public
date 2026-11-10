import { type EmailTransport, EmailTransportConfigError } from '../types.ts';
import { brevoAdapter } from './brevo.ts';
import {
  createHttpTransport,
  type HttpProvider,
  type HttpTransportOptions,
  providerFromApiUrl,
} from './common.ts';
import { resendAdapter } from './resend.ts';

export { brevoAdapter, parseMailbox } from './brevo.ts';
export {
  classifyHttpStatus,
  createHttpTransport,
  HTTP_PROVIDERS,
  type HttpProvider,
  type HttpTransportOptions,
  providerFromApiUrl,
} from './common.ts';
export { resendAdapter } from './resend.ts';

/** `EMAIL_API_URL` ana bilgisayarına göre sağlayıcı adaptörü; `provider` testler içindir. */
export function createHttpEmailTransport(
  opts: HttpTransportOptions,
  provider: HttpProvider = providerFromApiUrl(opts.baseUrl),
  fetchImpl?: typeof fetch,
): EmailTransport {
  if (opts.baseUrl === '') throw new EmailTransportConfigError('EMAIL_API_URL gerekli');
  return createHttpTransport(provider === 'resend' ? resendAdapter : brevoAdapter, opts, fetchImpl);
}

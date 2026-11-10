// next-intl istek yapılandırması: tek dil (tr), URL öneki yok (050 §16).
import { getRequestConfig } from 'next-intl/server';
import messages from '../../messages/tr.json';

export default getRequestConfig(async () => ({
  locale: 'tr',
  messages,
  timeZone: 'Europe/Istanbul',
}));

// next-intl istek yapılandırması (admin): tek dil, URL öneki yok.
import { getRequestConfig } from 'next-intl/server';
import messages from '../../messages/tr.json';

export default getRequestConfig(async () => ({
  locale: 'tr',
  messages,
  timeZone: 'Europe/Istanbul',
}));

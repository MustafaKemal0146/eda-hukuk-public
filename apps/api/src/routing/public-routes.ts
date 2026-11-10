// Oturumsuz `/api/v1/*` rotaları (040 §5.9; tek liste). Listeye ekleme CODEOWNERS onayı ister.
// Bu promptta hiçbiri kayıtlı değildir; kaydedildiklerinde `permission: 'public'` taşırlar.
export const PUBLIC_ROUTES = [
  'GET /api/v1/billing/plans',
  'POST /api/v1/billing/webhooks/iyzico',
  'POST /api/v1/account-recovery/{requestId}/complete',
  'POST /api/v1/account-recovery/{requestId}/cancel',
] as const;

export function isPublicRoute(method: string, path: string): boolean {
  return (PUBLIC_ROUTES as readonly string[]).includes(`${method.toUpperCase()} ${path}`);
}

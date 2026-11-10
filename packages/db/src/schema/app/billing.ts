// `app` ticari (030 §11) + faturalama ek tabloları (046 §11.1). Para `bigint` kuruş, kredi `int`.
// `credit_ledger` EKLİ ve aylık RANGE bölümlüdür; `credit_reservations` fillfactor = 90 (yama).
import {
  BILLING_CHECKOUT_STATUSES,
  BILLING_EVENT_OUTCOMES,
  BILLING_PERIODS,
  BILLING_TAX_KINDS,
  COUPON_DISCOUNT_TYPES,
  CREDIT_ENTRY_TYPES,
  CREDIT_OP_CODES,
  INVOICE_STATUSES,
  NOTE_CODES,
  PARTNER_COMMISSION_STATUSES,
  PAYMENT_STATUSES,
  PLAN_CODES,
  RESERVATION_STATUSES,
  SUBSCRIPTION_CHANGE_KINDS,
  SUBSCRIPTION_CHANGE_STATUSES,
  SUBSCRIPTION_PROVIDERS,
  SUBSCRIPTION_STATUSES,
} from '@eda/contracts/enums';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList, sqlValueList } from '../_checks.ts';
import { col, createdAt, fk, idV7, idV7NoPk, tstz, updatedAt } from '../_columns.ts';
import { bytea, tstzrange } from '../_types.ts';
import { organizations, users } from '../auth.ts';
import { appSchema, partners } from './partners.ts';

const notNull = (name: string) => sql`${col(name)} IS NOT NULL`;
const orgIdRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id);
const kurus = (name: string) => bigint(name, { mode: 'number' });
const LIVE_SUBSCRIPTION = sqlValueList(['trialing', 'active', 'past_due']);
const tryOnly = (table: string) => check(`${table}_currency_chk`, sql`${col('currency')} = 'TRY'`);

/** Paket tanımları (RLS K; miktarlar 093). */
export const plans = appSchema.table(
  'plans',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    perSeat: boolean('per_seat').notNull().default(false),
    seatMin: integer('seat_min').notNull().default(1),
    seatMax: integer('seat_max'),
    monthlyCredits: integer('monthly_credits').notNull(),
    monthlyOcrPages: integer('monthly_ocr_pages').notNull(),
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' }).notNull(),
    priceMonthlyKurus: kurus('price_monthly_kurus'),
    priceYearlyKurus: kurus('price_yearly_kurus'),
    features: jsonb('features').notNull().default(sql`'{}'::jsonb`),
    iyzicoPlanRefMonthly: text('iyzico_plan_ref_monthly'),
    iyzicoPlanRefYearly: text('iyzico_plan_ref_yearly'),
    isPublic: boolean('is_public').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('plans', t.code, PLAN_CODES),
    check('plans_seat_min_chk', sql`${col('seat_min')} >= 1`),
    check(
      'plans_seat_max_chk',
      sql`${col('seat_max')} IS NULL OR ${col('seat_max')} >= ${col('seat_min')}`,
    ),
    check('plans_monthly_credits_chk', sql`${col('monthly_credits')} >= 0`),
    check('plans_monthly_ocr_pages_chk', sql`${col('monthly_ocr_pages')} >= 0`),
  ],
);

/** Kupon/indirim (RLS K; `eda_app` SELECT YOK: kod listelenemez). */
export const coupons = appSchema.table(
  'coupons',
  {
    id: idV7(),
    code: text('code').notNull(),
    description: text('description'),
    discountType: text('discount_type').notNull(),
    percentOff: integer('percent_off'),
    amountOffKurus: kurus('amount_off_kurus'),
    planCodes: text('plan_codes').array(),
    durationMonths: integer('duration_months'),
    partnerId: uuid('partner_id').references(() => partners.id),
    baro: text('baro'),
    maxRedemptions: integer('max_redemptions'),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    validDuring: tstzrange('valid_during').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('coupons_code_uq').on(t.code),
    check('coupons_code_chk', sql`${col('code')} ~ '^[A-Z0-9-]{4,32}$'`),
    inList('coupons', t.discountType, COUPON_DISCOUNT_TYPES),
    check('coupons_percent_off_chk', sql`${col('percent_off')} BETWEEN 1 AND 100`),
    check('coupons_amount_off_kurus_chk', sql`${col('amount_off_kurus')} > 0`),
    check('coupons_duration_months_chk', sql`${col('duration_months')} > 0`),
    check('coupons_max_redemptions_chk', sql`${col('max_redemptions')} > 0`),
    check(
      'coupons_type_chk',
      sql`(${col('discount_type')} = 'percent') = (${col('percent_off')} IS NOT NULL) AND (${col('discount_type')} = 'amount') = (${col('amount_off_kurus')} IS NOT NULL)`,
    ),
    check(
      'coupons_limit_chk',
      sql`${col('max_redemptions')} IS NULL OR ${col('redeemed_count')} <= ${col('max_redemptions')}`,
    ),
    index('coupons_partner_idx').on(t.partnerId).where(notNull('partner_id')),
    index('coupons_created_by_idx').on(t.createdBy).where(notNull('created_by')),
  ],
);

/** Abonelik (RLS E; okuma owner/admin; yazma yalnız faturalama fonksiyonları). */
export const subscriptions = appSchema.table(
  'subscriptions',
  {
    id: idV7(),
    orgId: orgIdRef(),
    planCode: text('plan_code')
      .notNull()
      .references(() => plans.code),
    status: text('status').notNull(),
    billingPeriod: text('billing_period'),
    seats: integer('seats').notNull().default(1),
    priceKurus: kurus('price_kurus'),
    provider: text('provider').notNull().default('iyzico'),
    providerSubscriptionRef: text('provider_subscription_ref'),
    providerCustomerRef: text('provider_customer_ref'),
    couponId: uuid('coupon_id').references(() => coupons.id),
    trialEndsAt: tstz('trial_ends_at'),
    currentPeriodStart: tstz('current_period_start'),
    currentPeriodEnd: tstz('current_period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: tstz('canceled_at'),
    pastDueSince: tstz('past_due_since'),
    providerPlanRef: text('provider_plan_ref'),
    couponEndsAt: tstz('coupon_ends_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('subscriptions', t.status, SUBSCRIPTION_STATUSES),
    inList('subscriptions', t.billingPeriod, BILLING_PERIODS),
    check('subscriptions_seats_chk', sql`${col('seats')} >= 1`),
    inList('subscriptions', t.provider, SUBSCRIPTION_PROVIDERS),
    unique('subscriptions_org_id_uq').on(t.orgId, t.id),
    unique('subscriptions_provider_ref_uq').on(t.provider, t.providerSubscriptionRef),
    uniqueIndex('subscriptions_one_live_uq')
      .on(t.orgId)
      .where(sql`${col('status')} IN (${LIVE_SUBSCRIPTION})`),
    index('subscriptions_renewal_idx')
      .on(t.currentPeriodEnd)
      .where(sql`${col('status')} IN (${sqlValueList(['active', 'past_due'])})`),
    uniqueIndex('subscriptions_one_trial_uq')
      .on(t.orgId)
      .where(sql`${col('plan_code')} = 'trial'`),
  ],
);

/** Kredi hareketleri (EKLİ; aylık bölüm; FK yok; bakiye protokolü danışma kilidiyle). */
export const creditLedger = appSchema.table(
  'credit_ledger',
  {
    id: idV7NoPk(),
    orgId: uuid('org_id').notNull(),
    entryType: text('entry_type').notNull(),
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    opCode: text('op_code'),
    reservationId: uuid('reservation_id'),
    userId: uuid('user_id'),
    subscriptionId: uuid('subscription_id'),
    paymentId: uuid('payment_id'),
    couponRedemptionId: uuid('coupon_redemption_id'),
    expiresAt: tstz('expires_at'),
    noteCode: text('note_code'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'credit_ledger_pkey', columns: [t.id, t.createdAt] }),
    inList('credit_ledger', t.entryType, CREDIT_ENTRY_TYPES),
    check('credit_ledger_amount_chk', sql`${col('amount')} <> 0`),
    inList('credit_ledger', t.opCode, CREDIT_OP_CODES),
    inList('credit_ledger', t.noteCode, NOTE_CODES),
    check(
      'credit_ledger_sign_chk',
      sql`(${col('entry_type')} IN (${sqlValueList(['trial_grant', 'monthly_grant', 'purchase', 'refund'])}) AND ${col('amount')} > 0) OR (${col('entry_type')} IN (${sqlValueList(['consume', 'expire'])}) AND ${col('amount')} < 0) OR ${col('entry_type')} = 'adjustment'`,
    ),
    check(
      'credit_ledger_consume_chk',
      sql`${col('entry_type')} <> 'consume' OR ${col('op_code')} IS NOT NULL`,
    ),
    index('credit_ledger_org_idx').on(t.orgId, t.createdAt.desc()),
    index('credit_ledger_res_idx').on(t.orgId, t.reservationId).where(notNull('reservation_id')),
    index('credit_ledger_brin').using('brin', t.createdAt),
  ],
);

/** Süre aşımlı kredi rezervasyonları (defter §31.7). */
export const creditReservations = appSchema.table(
  'credit_reservations',
  {
    id: idV7(),
    orgId: orgIdRef(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    opCode: text('op_code').notNull(),
    credits: integer('credits').notNull(),
    status: text('status').notNull().default('held'),
    expiresAt: tstz('expires_at').notNull(),
    conversationId: uuid('conversation_id'),
    messageId: uuid('message_id'),
    documentId: uuid('document_id'),
    fileId: uuid('file_id'),
    settledAt: tstz('settled_at'),
    settledLedgerId: uuid('settled_ledger_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('credit_reservations', t.opCode, CREDIT_OP_CODES),
    check('credit_reservations_credits_chk', sql`${col('credits')} >= 0`),
    inList('credit_reservations', t.status, RESERVATION_STATUSES),
    index('credit_reservations_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${col('status')} IN (${sqlValueList(['held'])})`),
    index('credit_reservations_held_idx')
      .on(t.orgId, t.userId, t.opCode)
      .where(sql`${col('status')} IN (${sqlValueList(['held'])})`),
    index('credit_reservations_user_idx').on(t.userId).where(notNull('user_id')),
  ],
);

/** Fatura kayıtları (yasal saklama; FK yok). */
export const invoices = appSchema.table(
  'invoices',
  {
    id: idV7(),
    orgId: uuid('org_id').notNull(),
    subscriptionId: uuid('subscription_id'),
    invoiceNo: text('invoice_no'),
    status: text('status').notNull().default('draft'),
    currency: text('currency').notNull().default('TRY'),
    subtotalKurus: kurus('subtotal_kurus').notNull(),
    vatKurus: kurus('vat_kurus').notNull(),
    totalKurus: kurus('total_kurus').notNull(),
    vatRateBp: integer('vat_rate_bp').notNull(),
    periodStart: tstz('period_start'),
    periodEnd: tstz('period_end'),
    billingSnapshot: jsonb('billing_snapshot').notNull(),
    buyerTaxIdEnc: bytea('buyer_tax_id_enc'),
    providerInvoiceRef: text('provider_invoice_ref'),
    issuedAt: tstz('issued_at'),
    dueAt: tstz('due_at'),
    paidAt: tstz('paid_at'),
    voidedAt: tstz('voided_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('invoices_invoice_no_uq').on(t.invoiceNo),
    inList('invoices', t.status, INVOICE_STATUSES),
    tryOnly('invoices'),
    check(
      'invoices_total_chk',
      sql`${col('total_kurus')} = ${col('subtotal_kurus')} + ${col('vat_kurus')}`,
    ),
    index('invoices_org_idx').on(t.orgId, t.createdAt.desc()),
  ],
);

/** Ödeme kayıtları (kart verisi hiçbir kolonda yok; hosted checkout). */
export const payments = appSchema.table(
  'payments',
  {
    id: idV7(),
    orgId: uuid('org_id').notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    subscriptionId: uuid('subscription_id'),
    provider: text('provider').notNull(),
    providerPaymentRef: text('provider_payment_ref').notNull(),
    status: text('status').notNull(),
    amountKurus: kurus('amount_kurus').notNull(),
    currency: text('currency').notNull().default('TRY'),
    failureCode: text('failure_code'),
    occurredAt: tstz('occurred_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('payments', t.provider, SUBSCRIPTION_PROVIDERS),
    inList('payments', t.status, PAYMENT_STATUSES),
    check('payments_amount_kurus_chk', sql`${col('amount_kurus')} > 0`),
    tryOnly('payments'),
    unique('payments_provider_ref_uq').on(t.provider, t.providerPaymentRef),
    index('payments_org_idx').on(t.orgId, t.occurredAt.desc()),
    index('payments_invoice_idx').on(t.invoiceId).where(notNull('invoice_id')),
  ],
);

/** Kupon kullanımları (`app.redeem_coupon()` ile; P25). */
export const couponRedemptions = appSchema.table(
  'coupon_redemptions',
  {
    id: idV7(),
    orgId: orgIdRef(),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id),
    subscriptionId: uuid('subscription_id'),
    redeemedBy: uuid('redeemed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('coupon_redemptions_uq').on(t.couponId, t.orgId),
    fk(
      'coupon_redemptions_subscription_fk',
      [t.orgId, t.subscriptionId],
      [subscriptions.orgId, subscriptions.id],
    ).onDelete('set null'),
    index('coupon_redemptions_org_idx').on(t.orgId, t.subscriptionId),
    index('coupon_redemptions_redeemed_by_idx').on(t.redeemedBy).where(notNull('redeemed_by')),
  ],
);

/** Bayi komisyonu (V1.1; MVP'de boş; RLS —). */
export const partnerCommissions = appSchema.table(
  'partner_commissions',
  {
    id: idV7(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id),
    orgId: uuid('org_id').notNull(),
    periodMonth: date('period_month', { mode: 'string' }).notNull(),
    baseAmountKurus: kurus('base_amount_kurus').notNull(),
    rateBp: integer('rate_bp').notNull(),
    commissionKurus: kurus('commission_kurus').notNull(),
    status: text('status').notNull().default('calculated'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'partner_commissions_period_month_chk',
      sql`extract(day FROM ${col('period_month')}) = 1`,
    ),
    inList('partner_commissions', t.status, PARTNER_COMMISSION_STATUSES),
    unique('partner_commissions_uq').on(t.partnerId, t.orgId, t.periodMonth),
  ],
);

/** Büro fatura bilgisi (046 §11.1; vergi kimlik no platform faturalama anahtarıyla şifreli). */
export const billingProfiles = appSchema.table(
  'billing_profiles',
  {
    orgId: uuid('org_id')
      .primaryKey()
      .references(() => organizations.id),
    legalName: text('legal_name').notNull(),
    taxKind: text('tax_kind').notNull(),
    taxIdEnc: bytea('tax_id_enc').notNull(),
    taxIdLast4: text('tax_id_last4').notNull(),
    taxOffice: text('tax_office'),
    addressLine: text('address_line').notNull(),
    district: text('district'),
    city: text('city').notNull(),
    postalCode: text('postal_code'),
    country: text('country').notNull().default('TR'),
    invoiceEmail: text('invoice_email').notNull(),
    phone: text('phone').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('billing_profiles', t.taxKind, BILLING_TAX_KINDS),
    check('billing_profiles_tax_id_last4_chk', sql`${col('tax_id_last4')} ~ '^[0-9]{4}$'`),
    check(
      'billing_profiles_invoice_email_chk',
      sql`${col('invoice_email')} = lower(${col('invoice_email')})`,
    ),
    check(
      'billing_profiles_vkn_office_chk',
      sql`${col('tax_kind')} = 'tckn' OR ${col('tax_office')} IS NOT NULL`,
    ),
  ],
);

/** iyzico checkout oturumları (046 §11.1; yazma yalnız `app.billing_*` fonksiyonları). */
export const billingCheckouts = appSchema.table(
  'billing_checkouts',
  {
    id: idV7(),
    orgId: orgIdRef(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    planCode: text('plan_code')
      .notNull()
      .references(() => plans.code),
    billingPeriod: text('billing_period').notNull(),
    seats: integer('seats').notNull(),
    listPriceKurus: kurus('list_price_kurus').notNull(),
    priceKurus: kurus('price_kurus').notNull(),
    couponId: uuid('coupon_id').references(() => coupons.id),
    providerPlanRef: text('provider_plan_ref').notNull(),
    providerToken: text('provider_token'),
    providerTokenExpiresAt: tstz('provider_token_expires_at'),
    status: text('status').notNull().default('created'),
    providerSubscriptionRef: text('provider_subscription_ref'),
    failureCode: text('failure_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('billing_checkouts', t.billingPeriod, BILLING_PERIODS),
    check('billing_checkouts_seats_chk', sql`${col('seats')} >= 1`),
    inList('billing_checkouts', t.status, BILLING_CHECKOUT_STATUSES),
    uniqueIndex('billing_checkouts_one_open_uq')
      .on(t.orgId)
      .where(sql`${col('status')} IN (${sqlValueList(['created', 'awaiting_payment'])})`),
    index('billing_checkouts_org_idx').on(t.orgId, t.createdAt.desc()),
    index('billing_checkouts_user_idx').on(t.userId).where(notNull('user_id')),
  ],
);

/** İdempotent sağlayıcı olay günlüğü (046 §11.1; kart/kişisel veri YOK). */
export const billingEvents = appSchema.table(
  'billing_events',
  {
    idempotencyKey: text('idempotency_key').primaryKey(),
    kind: text('kind').notNull(),
    orgId: uuid('org_id'),
    subscriptionId: uuid('subscription_id'),
    outcome: text('outcome').notNull(),
    refs: jsonb('refs').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    inList('billing_events', t.outcome, BILLING_EVENT_OUTCOMES),
    index('billing_events_org_idx').on(t.orgId, t.createdAt.desc()),
  ],
);

/** Planlanmış abonelik değişiklikleri (046 §11.1). */
export const subscriptionChanges = appSchema.table(
  'subscription_changes',
  {
    id: idV7(),
    orgId: uuid('org_id').notNull(),
    subscriptionId: uuid('subscription_id').notNull(),
    kind: text('kind').notNull(),
    targetPlanCode: text('target_plan_code').references(() => plans.code),
    targetBillingPeriod: text('target_billing_period'),
    targetSeats: integer('target_seats'),
    targetPriceKurus: kurus('target_price_kurus'),
    providerPlanRef: text('provider_plan_ref'),
    effectiveAt: tstz('effective_at').notNull(),
    status: text('status').notNull().default('scheduled'),
    failureCode: text('failure_code'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('subscription_changes', t.kind, SUBSCRIPTION_CHANGE_KINDS),
    inList('subscription_changes', t.targetBillingPeriod, BILLING_PERIODS),
    check('subscription_changes_target_seats_chk', sql`${col('target_seats')} >= 1`),
    inList('subscription_changes', t.status, SUBSCRIPTION_CHANGE_STATUSES),
    fk(
      'subscription_changes_subscription_fk',
      [t.orgId, t.subscriptionId],
      [subscriptions.orgId, subscriptions.id],
    ),
    uniqueIndex('subscription_changes_one_scheduled_uq')
      .on(t.subscriptionId)
      .where(sql`${col('status')} IN (${sqlValueList(['scheduled'])})`),
    index('subscription_changes_due_idx')
      .on(t.effectiveAt)
      .where(sql`${col('status')} IN (${sqlValueList(['scheduled'])})`),
    index('subscription_changes_subscription_idx').on(t.orgId, t.subscriptionId),
    index('subscription_changes_requested_by_idx').on(t.requestedBy).where(notNull('requested_by')),
  ],
);

/** iyzico fiyat planı referansları (RLS K). */
export const providerPlanRefs = appSchema.table(
  'provider_plan_refs',
  {
    id: idV7(),
    provider: text('provider').notNull().default('iyzico'),
    planCode: text('plan_code')
      .notNull()
      .references(() => plans.code),
    billingPeriod: text('billing_period').notNull(),
    seats: integer('seats').notNull().default(1),
    priceKurus: kurus('price_kurus').notNull(),
    providerPlanRef: text('provider_plan_ref').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check('provider_plan_refs_provider_chk', sql`${col('provider')} = 'iyzico'`),
    inList('provider_plan_refs', t.billingPeriod, BILLING_PERIODS),
    check('provider_plan_refs_seats_chk', sql`${col('seats')} >= 1`),
    check('provider_plan_refs_price_kurus_chk', sql`${col('price_kurus')} > 0`),
    unique('provider_plan_refs_ref_uq').on(t.providerPlanRef),
    unique('provider_plan_refs_uq').on(
      t.provider,
      t.planCode,
      t.billingPeriod,
      t.seats,
      t.priceKurus,
    ),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type CreditReservation = typeof creditReservations.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type PartnerCommission = typeof partnerCommissions.$inferSelect;
export type BillingProfile = typeof billingProfiles.$inferSelect;
export type BillingCheckout = typeof billingCheckouts.$inferSelect;
export type BillingEvent = typeof billingEvents.$inferSelect;
export type SubscriptionChange = typeof subscriptionChanges.$inferSelect;
export type ProviderPlanRef = typeof providerPlanRefs.$inferSelect;

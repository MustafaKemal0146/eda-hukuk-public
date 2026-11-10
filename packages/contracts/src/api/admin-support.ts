// Yönetim paneli "Destek" modülü sözleşmeleri. Destek talebinin konu ve gövdesi panelde GÖSTERİLMEZ;
// yalnız kategori, öncelik, durum ve zaman. Durum değişikliği yalnız `super_admin` (step-up + denetim).
import { z } from 'zod';
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

export const SupportCountsDto = z.strictObject({
  pendingApplications: z.number().int(),
  oldestPendingAt: IsoDateTime.nullable(),
  suspendedUsers: z.number().int(),
  suspendedOrgs: z.number().int(),
  unverifiedEmails: z.number().int(),
  oldestUnverifiedAt: IsoDateTime.nullable(),
  tickets: z.strictObject({
    open: z.number().int(),
    inProgress: z.number().int(),
    waiting: z.number().int(),
    urgent: z.number().int(),
    oldestOpenAt: IsoDateTime.nullable(),
  }),
});

export const WORK_ITEM_KINDS = [
  'pending_application',
  'suspended_user',
  'unverified_email',
] as const;

export const SupportWorkItemDto = z.strictObject({
  kind: z.enum(WORK_ITEM_KINDS),
  refId: z.uuid(),
  partyEmail: z.string(),
  status: z.string(),
  sinceAt: IsoDateTime,
});

export const AdminSupportOverviewDto = z.strictObject({
  counts: SupportCountsDto,
  items: z.array(SupportWorkItemDto),
});
export type AdminSupportOverviewDtoValue = z.infer<typeof AdminSupportOverviewDto>;

export const ListTicketsQuery = z.strictObject({
  /** Verilmezse kapalı olmayanlar. */
  status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
  cursor: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListTicketsQueryValue = z.infer<typeof ListTicketsQuery>;

export const AdminTicketDto = z.strictObject({
  ticketId: z.uuid(),
  orgRef: z.uuid(),
  orgKind: z.string(),
  requesterEmail: z.string().nullable(),
  category: z.enum(SUPPORT_TICKET_CATEGORIES),
  priority: z.enum(SUPPORT_TICKET_PRIORITIES),
  status: z.enum(SUPPORT_TICKET_STATUSES),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  closedAt: IsoDateTime.nullable(),
});
export type AdminTicketDtoValue = z.infer<typeof AdminTicketDto>;

export const AdminTicketListResponse = z.strictObject({
  items: z.array(AdminTicketDto),
  nextCursor: IsoDateTime.nullable(),
  /** Konu ve gövde okunmaz (içerik sınırı). */
  contentHidden: z.literal(true),
});
export type AdminTicketListResponseValue = z.infer<typeof AdminTicketListResponse>;

export const SetTicketStatusInput = z.strictObject({ status: z.enum(SUPPORT_TICKET_STATUSES) });
export type SetTicketStatusInputValue = z.infer<typeof SetTicketStatusInput>;

export const SetTicketStatusResult = z.strictObject({
  ticketId: z.uuid(),
  status: z.enum(SUPPORT_TICKET_STATUSES),
});
export type SetTicketStatusResultValue = z.infer<typeof SetTicketStatusResult>;

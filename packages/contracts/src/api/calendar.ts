// Takvim etkinliği ve hatırlatıcı sözleşmeleri (041 §2.4, §6.1, §6.3, §6.5; 053-ekranlar/07 §6; P22.2).
// Başlık, not ve konum log, span, metrik ve bildirim yüküne yazılmaz (Y-63, 045 §4.1).
import { z } from 'zod';
import { CONFIG_DEFAULTS } from '../config/defaults.ts';
import { CALENDAR_EVENT_TYPES, NOTIFICATION_CHANNELS, REMINDER_STATUSES } from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

/** `type = deadline` etkinlik yalnız süre onayıyla (`POST /deadlines`) türetilir (041 §6.1). */
export const ManualCalendarEventType = z.enum(CALENDAR_EVENT_TYPES).exclude(['deadline']);

/** Hatırlatıcı ofseti: hedef zamandan önce 5 dakika ile 30 gün (041 §6.3). */
export const REMINDER_OFFSET_MIN_MINUTES = 5;
export const REMINDER_OFFSET_MAX_MINUTES = 43200;

export const ReminderSpec = z.strictObject({
  offsetMinutes: z.number().int().min(REMINDER_OFFSET_MIN_MINUTES).max(REMINDER_OFFSET_MAX_MINUTES),
  channel: z.enum(NOTIFICATION_CHANNELS),
});
export type ReminderSpecValue = z.infer<typeof ReminderSpec>;

/** Hedef olarak `calendarEventId` ya da `deadlineId`; ikisi birden verilmez (041 §6.3). */
export const ReminderInput = z.union([
  ReminderSpec.extend({ calendarEventId: z.uuid() }),
  ReminderSpec.extend({ deadlineId: z.uuid() }),
]);
export type ReminderInputValue = z.infer<typeof ReminderInput>;

export const ReminderSpecList = z
  .array(ReminderSpec)
  .max(CONFIG_DEFAULTS['reminders.maxPerTarget']);

export const EventInput = z.strictObject({
  type: ManualCalendarEventType,
  title: z.string().min(1).max(200),
  caseId: z.uuid().nullable().optional(),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime.nullable().optional(),
  allDay: z.boolean(),
  timezone: z.string().min(1).optional(),
  location: z.string().max(200).nullable().optional(),
  courtCode: z.string().nullable().optional(),
  esasNo: z.string().max(32).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  reminders: ReminderSpecList.optional(),
});
export type EventInputValue = z.infer<typeof EventInput>;

export const EventPatchInput = EventInput.omit({ type: true, reminders: true })
  .partial()
  .extend({ completedAt: IsoDateTime.nullable().optional() });
export type EventPatchInputValue = z.infer<typeof EventPatchInput>;

export const ReminderDto = z.strictObject({
  id: z.uuid(),
  calendarEventId: z.uuid().nullable(),
  deadlineId: z.uuid().nullable(),
  remindAt: IsoDateTime,
  channel: z.enum(NOTIFICATION_CHANNELS),
  status: z.enum(REMINDER_STATUSES),
  sentAt: IsoDateTime.nullable(),
});
export type ReminderDtoValue = z.infer<typeof ReminderDto>;

export const CalendarEventDto = z.strictObject({
  id: z.uuid(),
  type: z.enum(CALENDAR_EVENT_TYPES),
  title: z.string(),
  caseId: z.uuid().nullable(),
  deadlineId: z.uuid().nullable(),
  userId: z.uuid(),
  location: z.string().nullable(),
  courtCode: z.string().nullable(),
  esasNo: z.string().nullable(),
  notes: z.string().nullable(),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime.nullable(),
  allDay: z.boolean(),
  timezone: z.string(),
  completedAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  reminders: z.array(ReminderDto),
});
export type CalendarEventDtoValue = z.infer<typeof CalendarEventDto>;

/** `GET /calendar/events` sorgusu: aralık zorunludur, en çok `calendar.rangeMaxDays` gün (041 §6.1). */
export const ListEventsQuery = z.strictObject({
  from: IsoDateTime,
  to: IsoDateTime,
  caseId: z.uuid().optional(),
});
export type ListEventsQueryValue = z.infer<typeof ListEventsQuery>;

export const EventListResponse = z.strictObject({ items: z.array(CalendarEventDto) });
export type EventListResponseValue = z.infer<typeof EventListResponse>;

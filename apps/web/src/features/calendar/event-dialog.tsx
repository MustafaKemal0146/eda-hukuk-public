'use client';
// Etkinlik ekle/düzenle penceresi. Süreden türeyen (deadline) etkinliğin zamanı kilitlidir; yalnız
// başlık/not düzenlenir. Hatırlatıcı yalnız yeni etkinlikte seçilir (başlangıçtan önce, uygulama içi).
import type { CalendarEventDtoValue } from '@eda/contracts/api/calendar';
import {
  Button,
  Checkbox,
  DateField,
  Dialog,
  Field,
  Input,
  Select,
  Textarea,
  TimeField,
} from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ApiClientError, authRedirectFor, documentsApi } from '../studio/documents-api.ts';
import { isoDate } from './month.ts';
import { MANUAL_TYPES, type ManualType, toIsoRange } from './range.ts';

const REMINDERS = ['none', '15', '60', '1440'] as const;
type ReminderChoice = (typeof REMINDERS)[number];

const hhmm = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function EventDialog({
  open,
  initial,
  day,
  onClose,
  onSaved,
  onAuth,
}: {
  open: boolean;
  initial: CalendarEventDtoValue | null;
  day: Date;
  onClose: () => void;
  onSaved: (event: CalendarEventDtoValue) => void;
  onAuth: (to: string) => void;
}) {
  const t = useTranslations('calendar');
  const [type, setType] = useState<ManualType>('hearing');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(isoDate(day));
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('11:00');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [reminder, setReminder] = useState<ReminderChoice>('1440');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const derived = initial?.deadlineId != null;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    if (initial) {
      const s = new Date(initial.startsAt);
      setType(
        (MANUAL_TYPES as readonly string[]).includes(initial.type)
          ? (initial.type as ManualType)
          : 'task',
      );
      setTitle(initial.title);
      setDate(isoDate(s));
      setAllDay(initial.allDay);
      setStart(initial.allDay ? '10:00' : hhmm(s));
      setEnd(initial.endsAt && !initial.allDay ? hhmm(new Date(initial.endsAt)) : '');
      setLocation(initial.location ?? '');
      setNotes(initial.notes ?? '');
    } else {
      setType('hearing');
      setTitle('');
      setDate(isoDate(day));
      setAllDay(false);
      setStart('10:00');
      setEnd('11:00');
      setLocation('');
      setNotes('');
      setReminder('1440');
    }
  }, [open, initial, day]);

  async function submit() {
    if (title.trim() === '') {
      setError(t('form.errors.title'));
      return;
    }
    const range = toIsoRange(date, allDay, start, end);
    if (!range) {
      setError(t('form.errors.time'));
      return;
    }
    if (range.endsAt !== null && new Date(range.endsAt) <= new Date(range.startsAt)) {
      setError(t('form.errors.range'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const common = {
        title: title.trim(),
        location: location.trim() === '' ? null : location.trim(),
        notes: notes.trim() === '' ? null : notes.trim(),
      };
      const saved = initial
        ? await documentsApi.calendar.patchEvent(initial.id, {
            ...common,
            ...(derived ? {} : { ...range, allDay }),
          })
        : await documentsApi.calendar.createEvent({
            type,
            ...common,
            ...range,
            allDay,
            timezone: 'Europe/Istanbul',
            ...(reminder === 'none'
              ? {}
              : { reminders: [{ offsetMinutes: Number(reminder), channel: 'in_app' as const }] }),
          });
      onSaved(saved);
    } catch (err) {
      const to = authRedirectFor(err, '/takvim');
      if (to) {
        onAuth(to);
        return;
      }
      setError(
        err instanceof ApiClientError && err.code === 'CAL_INVALID_RANGE'
          ? t('form.errors.range')
          : t('form.errors.save'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={initial ? t('form.editTitle') : t('form.addTitle')}
      labels={{ close: t('form.close') }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button loading={busy} loadingLabel={t('form.saving')} onClick={() => void submit()}>
            {t('form.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!initial && (
          <Field label={t('form.type')}>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as ManualType)}
              options={MANUAL_TYPES.map((k) => ({ value: k, label: t(`types.${k}`) }))}
            />
          </Field>
        )}
        <Field label={t('form.title')} required>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('form.date')} description={derived ? t('form.derivedNote') : undefined}>
          <DateField value={date} disabled={derived} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Checkbox
          checked={allDay}
          disabled={derived}
          onCheckedChange={setAllDay}
          label={t('form.allDay')}
        />
        {!allDay && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('form.start')}>
              <TimeField
                value={start}
                disabled={derived}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label={t('form.end')}>
              <TimeField value={end} disabled={derived} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label={t('form.location')}>
          <Input value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label={t('form.notes')}>
          <Textarea
            rows={3}
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {!initial && (
          <Field label={t('form.reminder')}>
            <Select
              value={reminder}
              onChange={(e) => setReminder(e.target.value as ReminderChoice)}
              options={REMINDERS.map((k) => ({ value: k, label: t(`form.reminders.${k}`) }))}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

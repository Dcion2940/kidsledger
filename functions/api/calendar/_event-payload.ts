const normalizeReminder = (item: any) => ({
  method: String(item?.method || 'popup') === 'email' ? 'email' : 'popup',
  minutes: Math.max(0, Number(item?.minutes ?? 30) || 0)
});

const shiftDateString = (value: string, days: number) => {
  const [year, month, day] = value.split('-').map((item) => Number(item));
  const base = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

export const normalizeCalendarShortcutBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on', 'important', '重要'].includes(normalized);
};

export const buildGoogleEventPayload = (payload: any) => {
  const title = String(payload?.title || '').trim();
  const startDate = String(payload?.startDate || '').trim();
  const endDate = String(payload?.endDate || '').trim();
  const startTime = String(payload?.startTime || '').trim();
  const endTime = String(payload?.endTime || '').trim();
  const allDay = normalizeCalendarShortcutBoolean(payload?.allDay);
  const reminders = Array.isArray(payload?.reminders) ? payload.reminders.map(normalizeReminder) : [];

  if (!title) return { error: 'Title is required' };
  if (!startDate) return { error: 'Start date is required' };
  if (!endDate) return { error: 'End date is required' };
  if (!allDay && (!startTime || !endTime)) return { error: 'Start time and end time are required' };
  if (!allDay) {
    const startAt = new Date(`${startDate}T${startTime}:00+08:00`).getTime();
    const endAt = new Date(`${endDate}T${endTime}:00+08:00`).getTime();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
      return { error: 'Invalid event time' };
    }
    if (endAt <= startAt) {
      return { error: '結束時間必須晚於開始時間' };
    }
  }

  const start = allDay
    ? { date: startDate }
    : { dateTime: `${startDate}T${startTime}:00+08:00`, timeZone: 'Asia/Taipei' };
  const end = allDay
    ? { date: shiftDateString(endDate, 1) }
    : { dateTime: `${endDate}T${endTime}:00+08:00`, timeZone: 'Asia/Taipei' };
  return {
    payload: {
      summary: title,
      description: String(payload?.description || ''),
      location: String(payload?.location || ''),
      start,
      end,
      reminders: reminders.length
        ? {
            useDefault: false,
            overrides: reminders
          }
        : {
            useDefault: true
          }
    },
    sendUpdates: 'none'
  };
};

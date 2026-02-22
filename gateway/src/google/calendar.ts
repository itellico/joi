// Google Calendar API wrapper
// Multi-account: all functions accept optional accountId

import { google, type calendar_v3 } from "googleapis";
import { getAuthClient } from "./auth.js";

const calendarCache = new Map<string, calendar_v3.Calendar>();

async function getCalendar(accountId?: string): Promise<calendar_v3.Calendar> {
  const key = accountId || "_default";
  if (calendarCache.has(key)) return calendarCache.get(key)!;
  const auth = await getAuthClient(accountId);
  const cal = google.calendar({ version: "v3", auth });
  calendarCache.set(key, cal);
  return cal;
}

export interface CalendarInfo {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  timeZone?: string;
  backgroundColor?: string;
}

export async function listCalendars(accountId?: string): Promise<CalendarInfo[]> {
  const cal = await getCalendar(accountId);
  const { data } = await cal.calendarList.list({ showHidden: false });

  return (data.items || []).map((c) => ({
    id: c.id!,
    summary: c.summary || "",
    description: c.description || undefined,
    primary: c.primary || false,
    timeZone: c.timeZone || undefined,
    backgroundColor: c.backgroundColor || undefined,
  }));
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  status?: string;
  htmlLink?: string;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  organizer?: { email: string; displayName?: string };
  recurrence?: string[];
}

function parseEventTime(t: calendar_v3.Schema$EventDateTime | undefined): { dateTime: string; allDay: boolean } {
  if (!t) return { dateTime: "", allDay: false };
  if (t.date) return { dateTime: t.date, allDay: true };
  return { dateTime: t.dateTime || "", allDay: false };
}

function mapEvent(e: calendar_v3.Schema$Event): CalendarEvent {
  const start = parseEventTime(e.start);
  const end = parseEventTime(e.end);
  return {
    id: e.id!,
    summary: e.summary || "(no title)",
    description: e.description || undefined,
    location: e.location || undefined,
    start: start.dateTime,
    end: end.dateTime,
    allDay: start.allDay,
    status: e.status || undefined,
    htmlLink: e.htmlLink || undefined,
    attendees: e.attendees?.map((a) => ({
      email: a.email!,
      displayName: a.displayName || undefined,
      responseStatus: a.responseStatus || undefined,
    })),
    organizer: e.organizer
      ? { email: e.organizer.email!, displayName: e.organizer.displayName || undefined }
      : undefined,
    recurrence: e.recurrence || undefined,
  };
}

export async function listEvents(opts: {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  query?: string;
  accountId?: string;
}): Promise<CalendarEvent[]> {
  const cal = await getCalendar(opts.accountId);
  const calId = opts.calendarId || "primary";

  const params: calendar_v3.Params$Resource$Events$List = {
    calendarId: calId,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: opts.maxResults || 25,
  };

  if (opts.timeMin) params.timeMin = opts.timeMin;
  if (opts.timeMax) params.timeMax = opts.timeMax;
  if (opts.query) params.q = opts.query;

  const { data } = await cal.events.list(params);
  return (data.items || []).map(mapEvent);
}

export async function createEvent(opts: {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  startDateTime?: string;
  endDateTime?: string;
  startDate?: string;
  endDate?: string;
  timeZone?: string;
  attendees?: string[];
  recurrence?: string[];
  accountId?: string;
}): Promise<CalendarEvent> {
  const cal = await getCalendar(opts.accountId);
  const calId = opts.calendarId || "primary";
  const tz = opts.timeZone || "Europe/Vienna";

  const event: calendar_v3.Schema$Event = {
    summary: opts.summary,
    description: opts.description,
    location: opts.location,
  };

  if (opts.startDate) {
    event.start = { date: opts.startDate };
    event.end = { date: opts.endDate || opts.startDate };
  } else {
    event.start = { dateTime: opts.startDateTime, timeZone: tz };
    event.end = { dateTime: opts.endDateTime, timeZone: tz };
  }

  if (opts.attendees) {
    event.attendees = opts.attendees.map((email) => ({ email }));
  }

  if (opts.recurrence) {
    event.recurrence = opts.recurrence;
  }

  const { data } = await cal.events.insert({
    calendarId: calId,
    requestBody: event,
  });

  return mapEvent(data);
}

export async function updateEvent(opts: {
  calendarId?: string;
  eventId: string;
  summary?: string;
  description?: string;
  location?: string;
  startDateTime?: string;
  endDateTime?: string;
  startDate?: string;
  endDate?: string;
  timeZone?: string;
  accountId?: string;
}): Promise<CalendarEvent> {
  const cal = await getCalendar(opts.accountId);
  const calId = opts.calendarId || "primary";
  const tz = opts.timeZone || "Europe/Vienna";

  // Fetch existing event to merge
  const { data: existing } = await cal.events.get({
    calendarId: calId,
    eventId: opts.eventId,
  });

  if (opts.summary !== undefined) existing.summary = opts.summary;
  if (opts.description !== undefined) existing.description = opts.description;
  if (opts.location !== undefined) existing.location = opts.location;

  if (opts.startDate) {
    existing.start = { date: opts.startDate };
    existing.end = { date: opts.endDate || opts.startDate };
  } else if (opts.startDateTime) {
    existing.start = { dateTime: opts.startDateTime, timeZone: tz };
    if (opts.endDateTime) existing.end = { dateTime: opts.endDateTime, timeZone: tz };
  }

  const { data } = await cal.events.update({
    calendarId: calId,
    eventId: opts.eventId,
    requestBody: existing,
  });

  return mapEvent(data);
}

export async function deleteEvent(opts: {
  calendarId?: string;
  eventId: string;
  accountId?: string;
}): Promise<void> {
  const cal = await getCalendar(opts.accountId);
  await cal.events.delete({
    calendarId: opts.calendarId || "primary",
    eventId: opts.eventId,
  });
}

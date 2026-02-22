// Google Calendar agent tools
// Registered into the main tool registry (same pattern as accounting/tools.ts)

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import {
  listCalendars,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} from "./calendar.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const handlers = new Map<string, ToolHandler>();

// ─── calendar_list_calendars ───

handlers.set("calendar_list_calendars", async (input) => {
  const { account } = (input || {}) as { account?: string };
  const calendars = await listCalendars(account);
  return { calendars, count: calendars.length };
});

// ─── calendar_list_events ───

handlers.set("calendar_list_events", async (input) => {
  const { calendar_id, time_min, time_max, max_results, query, account } = input as {
    calendar_id?: string;
    time_min?: string;
    time_max?: string;
    max_results?: number;
    query?: string;
    account?: string;
  };

  const events = await listEvents({
    calendarId: calendar_id,
    timeMin: time_min,
    timeMax: time_max,
    maxResults: max_results,
    query,
    accountId: account,
  });

  return { events, count: events.length };
});

// ─── calendar_create_event ───

handlers.set("calendar_create_event", async (input) => {
  const {
    calendar_id, summary, description, location,
    start_datetime, end_datetime, start_date, end_date,
    timezone, attendees, recurrence, account,
  } = input as {
    calendar_id?: string;
    summary: string;
    description?: string;
    location?: string;
    start_datetime?: string;
    end_datetime?: string;
    start_date?: string;
    end_date?: string;
    timezone?: string;
    attendees?: string[];
    recurrence?: string[];
    account?: string;
  };

  const event = await createEvent({
    calendarId: calendar_id,
    summary,
    description,
    location,
    startDateTime: start_datetime,
    endDateTime: end_datetime,
    startDate: start_date,
    endDate: end_date,
    timeZone: timezone,
    attendees,
    recurrence,
    accountId: account,
  });

  return { created: true, event };
});

// ─── calendar_update_event ───

handlers.set("calendar_update_event", async (input) => {
  const {
    calendar_id, event_id, summary, description, location,
    start_datetime, end_datetime, start_date, end_date, timezone, account,
  } = input as {
    calendar_id?: string;
    event_id: string;
    summary?: string;
    description?: string;
    location?: string;
    start_datetime?: string;
    end_datetime?: string;
    start_date?: string;
    end_date?: string;
    timezone?: string;
    account?: string;
  };

  const event = await updateEvent({
    calendarId: calendar_id,
    eventId: event_id,
    summary,
    description,
    location,
    startDateTime: start_datetime,
    endDateTime: end_datetime,
    startDate: start_date,
    endDate: end_date,
    timeZone: timezone,
    accountId: account,
  });

  return { updated: true, event };
});

// ─── calendar_delete_event ───

handlers.set("calendar_delete_event", async (input) => {
  const { calendar_id, event_id, account } = input as {
    calendar_id?: string;
    event_id: string;
    account?: string;
  };

  await deleteEvent({ calendarId: calendar_id, eventId: event_id, accountId: account });
  return { deleted: true, eventId: event_id };
});

// ─── Exports ───

export function getCalendarToolHandlers(): Map<string, ToolHandler> {
  return handlers;
}

const accountParam = {
  type: "string",
  description: "Google account ID to use (default: primary account)",
} as const;

export function getCalendarToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "calendar_list_calendars",
      description: "List all Google Calendars available to the user.",
      input_schema: {
        type: "object" as const,
        properties: {
          account: accountParam,
        },
        required: [],
      },
    },
    {
      name: "calendar_list_events",
      description:
        "List events from Google Calendar. Filter by time range, search query, or calendar. Defaults to the primary calendar.",
      input_schema: {
        type: "object" as const,
        properties: {
          calendar_id: { type: "string", description: "Calendar ID (default: primary)" },
          time_min: { type: "string", description: "Start of time range (ISO 8601, e.g. '2026-02-19T00:00:00+01:00')" },
          time_max: { type: "string", description: "End of time range (ISO 8601)" },
          max_results: { type: "number", description: "Max events to return (default: 25)" },
          query: { type: "string", description: "Free-text search query" },
          account: accountParam,
        },
        required: [],
      },
    },
    {
      name: "calendar_create_event",
      description:
        "Create a new Google Calendar event. Use start_datetime/end_datetime for timed events, or start_date/end_date for all-day events.",
      input_schema: {
        type: "object" as const,
        properties: {
          calendar_id: { type: "string", description: "Calendar ID (default: primary)" },
          summary: { type: "string", description: "Event title" },
          description: { type: "string", description: "Event description" },
          location: { type: "string", description: "Event location" },
          start_datetime: { type: "string", description: "Start time (ISO 8601, e.g. '2026-02-20T14:00:00')" },
          end_datetime: { type: "string", description: "End time (ISO 8601)" },
          start_date: { type: "string", description: "All-day start date (YYYY-MM-DD)" },
          end_date: { type: "string", description: "All-day end date (YYYY-MM-DD)" },
          timezone: { type: "string", description: "Timezone (default: Europe/Vienna)" },
          attendees: { type: "array", items: { type: "string" }, description: "Email addresses of attendees" },
          recurrence: { type: "array", items: { type: "string" }, description: "RRULE strings (e.g. ['RRULE:FREQ=WEEKLY;COUNT=10'])" },
          account: accountParam,
        },
        required: ["summary"],
      },
    },
    {
      name: "calendar_update_event",
      description: "Update an existing Google Calendar event. Only provided fields are changed.",
      input_schema: {
        type: "object" as const,
        properties: {
          calendar_id: { type: "string", description: "Calendar ID (default: primary)" },
          event_id: { type: "string", description: "Event ID to update" },
          summary: { type: "string", description: "New event title" },
          description: { type: "string", description: "New description" },
          location: { type: "string", description: "New location" },
          start_datetime: { type: "string", description: "New start time (ISO 8601)" },
          end_datetime: { type: "string", description: "New end time (ISO 8601)" },
          start_date: { type: "string", description: "New all-day start date (YYYY-MM-DD)" },
          end_date: { type: "string", description: "New all-day end date (YYYY-MM-DD)" },
          timezone: { type: "string", description: "Timezone (default: Europe/Vienna)" },
          account: accountParam,
        },
        required: ["event_id"],
      },
    },
    {
      name: "calendar_delete_event",
      description: "Delete a Google Calendar event.",
      input_schema: {
        type: "object" as const,
        properties: {
          calendar_id: { type: "string", description: "Calendar ID (default: primary)" },
          event_id: { type: "string", description: "Event ID to delete" },
          account: accountParam,
        },
        required: ["event_id"],
      },
    },
  ];
}

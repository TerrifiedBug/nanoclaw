import { createDAVClient, DAVCalendar } from 'tsdav';
import { parseICS, CalendarEvent } from './parser';
import { randomUUID } from 'crypto';

export interface CalDAVAccount {
  name: string;
  serverUrl: string;
  user: string;
  pass: string;
}

export function loadAccounts(): CalDAVAccount[] {
  const raw = process.env.CALDAV_ACCOUNTS;
  if (!raw) {
    console.error('Error: CALDAV_ACCOUNTS environment variable not set.');
    console.error('Configure it via the /add-cal skill or set it manually in .env');
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error('Error: CALDAV_ACCOUNTS is not valid JSON');
    process.exit(1);
  }
}

export interface CalendarInfo {
  displayName: string;
  url: string;
  account: string;
}

async function createClient(account: CalDAVAccount) {
  return createDAVClient({
    serverUrl: account.serverUrl,
    credentials: { username: account.user, password: account.pass },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
}

export async function listCalendars(account: CalDAVAccount): Promise<CalendarInfo[]> {
  const client = await createClient(account);
  const calendars = await client.fetchCalendars();
  return calendars.map((cal) => ({
    displayName: String(cal.displayName || cal.url),
    url: cal.url,
    account: account.name,
  }));
}

export async function getEvents(
  account: CalDAVAccount,
  from: string,
  to: string,
  calendarName?: string,
): Promise<CalendarEvent[]> {
  const client = await createClient(account);
  let calendars = await client.fetchCalendars();

  if (calendarName) {
    calendars = calendars.filter(
      (c) => String(c.displayName || '').toLowerCase() === calendarName.toLowerCase(),
    );
    if (calendars.length === 0) {
      console.error(`No calendar found matching "${calendarName}" in account "${account.name}"`);
      return [];
    }
  }

  const allEvents: CalendarEvent[] = [];

  for (const calendar of calendars) {
    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start: from, end: to },
    });

    for (const obj of objects) {
      if (obj.data) {
        const events = parseICS(
          obj.data,
          String(calendar.displayName || calendar.url),
          account.name,
        );
        allEvents.push(...events);
      }
    }
  }

  return allEvents;
}

function toICSDate(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function buildICalString(opts: {
  uid: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NanoClaw//cal-cli//EN',
    'BEGIN:VEVENT',
    `UID:${opts.uid}`,
    `DTSTAMP:${toICSDate(new Date().toISOString())}`,
    `DTSTART:${toICSDate(opts.start)}`,
    `DTEND:${toICSDate(opts.end)}`,
    `SUMMARY:${opts.summary}`,
  ];
  if (opts.location) lines.push(`LOCATION:${opts.location}`);
  if (opts.description) lines.push(`DESCRIPTION:${opts.description}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

async function findCalendar(
  client: Awaited<ReturnType<typeof createDAVClient>>,
  calendarName: string,
  accountName: string,
): Promise<DAVCalendar | null> {
  const calendars = await client.fetchCalendars();
  const match = calendars.find(
    (c) => String(c.displayName || '').toLowerCase() === calendarName.toLowerCase(),
  );
  if (!match) {
    console.error(`No calendar found matching "${calendarName}" in account "${accountName}"`);
    console.error(`Available: ${calendars.map((c) => String(c.displayName || c.url)).join(', ')}`);
    return null;
  }
  return match;
}

export async function createEvent(
  account: CalDAVAccount,
  calendarName: string,
  title: string,
  start: string,
  end: string,
  location?: string,
  description?: string,
): Promise<boolean> {
  const client = await createClient(account);
  const calendar = await findCalendar(client, calendarName, account.name);
  if (!calendar) return false;

  const uid = `${randomUUID()}@nanoclaw`;
  const iCalString = buildICalString({ uid, summary: title, start, end, location, description });

  const result = await client.createCalendarObject({
    calendar,
    filename: `${uid}.ics`,
    iCalString,
  });

  if (result.ok) {
    console.log(`Event created: "${title}" on ${start}`);
    console.log(`Calendar: [${account.name}] ${calendarName}`);
    return true;
  } else {
    console.error(`Failed to create event: ${result.status} ${result.statusText}`);
    return false;
  }
}

---
name: calendar
description: Access calendar events, create appointments, check schedule. Supports Google Calendar (gog) and CalDAV providers like iCloud, Nextcloud, Fastmail (cal). Use for scheduling, reminders, and calendar management.
allowed-tools: Bash(gog:*, cal:*)
---

# Calendar Access

Run `/add-cal` on the host to configure calendar providers.

**IMPORTANT: Two separate tools exist. Check which are configured and use all available ones.**

- **`gog`** — Google Calendar (read/write via API) — available if `$GOG_KEYRING_PASSWORD` is set
- **`cal`** — CalDAV providers: iCloud, Nextcloud, Fastmail (read/write via CalDAV) — available if `$CALDAV_ACCOUNTS` is set

Before your first calendar command, check what's available:
```bash
[ -n "$GOG_KEYRING_PASSWORD" ] && echo "gog: available" || echo "gog: not configured"
[ -n "$CALDAV_ACCOUNTS" ] && echo "cal: available" || echo "cal: not configured"
```

When the user asks about "my calendars", "my schedule", or "what's on today", use ALL configured tools — neither alone shows the full picture.

## CalDAV Calendars (`cal`)

```bash
# List all CalDAV calendars
cal calendars

# List calendars from a specific account
cal calendars --account iCloud

# Today's events
cal events --from $(date -u +%Y-%m-%dT00:00:00Z) --to $(date -u -d '+1 day' +%Y-%m-%dT00:00:00Z)

# Events from a specific calendar
cal events "Personal" --from $(date -u +%Y-%m-%dT00:00:00Z) --to $(date -u -d '+1 day' +%Y-%m-%dT00:00:00Z)

# Events from a specific account
cal events --account iCloud --from $(date -u +%Y-%m-%dT00:00:00Z) --to $(date -u -d '+7 days' +%Y-%m-%dT00:00:00Z)

# Create an event
cal create "Personal" --title "Dentist" --start 2024-03-01T10:00:00Z --end 2024-03-01T11:00:00Z
cal create "Work" --title "Team standup" --start 2024-03-01T09:00:00Z --end 2024-03-01T09:30:00Z --location "Room 3"
cal create "Home" --title "Plumber" --start 2024-03-01T14:00:00Z --end 2024-03-01T15:00:00Z --description "Fix kitchen tap" --account iCloud

# Create an all-day event
cal create "Personal" --title "Holiday" --start 2024-03-01 --end 2024-03-02 --all-day

# Create a recurring event (every Tuesday, all-day)
cal create "Work" --title "Office Day" --start 2024-03-05 --end 2024-03-06 --all-day --rrule "FREQ=WEEKLY;BYDAY=TU"

# Create a recurring event (monthly on the 1st)
cal create "Bills" --title "Rent Due" --start 2024-03-01T09:00:00Z --end 2024-03-01T09:30:00Z --rrule "FREQ=MONTHLY;BYMONTHDAY=1"
```

# Delete an event (matches by title substring or UID)
cal delete "Personal" --title "Dentist"
cal delete "Work" --title "Office Day" --account iCloud
```

### CalDAV create options
- `--all-day` — all-day event. Use date-only format for --start/--end (YYYY-MM-DD). --end should be the NEXT day.
- `--rrule RULE` — recurrence rule in iCalendar format (without the `RRULE:` prefix). Examples: `FREQ=WEEKLY;BYDAY=TU`, `FREQ=MONTHLY;BYMONTHDAY=1`, `FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15`

### Environment
- Requires `CALDAV_ACCOUNTS` environment variable (JSON array)
- `cal` binary is pre-installed in the container

## Google Calendar (`gog`)

```bash
# List all calendars
gog calendar calendars

# Today's events
gog calendar events default --from $(date -u +%Y-%m-%dT00:00:00Z) --to $(date -u -d '+1 day' +%Y-%m-%dT23:59:59Z)

# Tomorrow's schedule
gog calendar events default --from $(date -u -d '+1 day' +%Y-%m-%dT00:00:00Z) --to $(date -u -d '+2 days' +%Y-%m-%dT23:59:59Z)

# This week
gog calendar events default --from $(date -u +%Y-%m-%dT00:00:00Z) --to $(date -u -d '+7 days' +%Y-%m-%dT23:59:59Z)

# Create event
gog calendar create --calendar "$CALENDAR_ID" \
  --title "Event Title" \
  --start "2024-01-01T09:00:00Z" \
  --end "2024-01-01T10:00:00Z"
```

### Environment
- Requires `GOG_KEYRING_PASSWORD` environment variable
- gog config mounted read-only at `/home/node/.config/gogcli/`

## Tips

- Use `gog calendar calendars` and `cal calendars` to discover available calendars and their IDs/names
- Use ISO 8601 timestamps in UTC
- For a combined view, run both tools and merge results
- When creating events, match the calendar name exactly as shown by `cal calendars`

### Morning Digest Example

```bash
TODAY_START=$(date -u +%Y-%m-%dT00:00:00Z)
TODAY_END=$(date -u -d '+1 day' +%Y-%m-%dT00:00:00Z)

echo "=== Google Calendar ==="
gog calendar events default --from "$TODAY_START" --to "$TODAY_END"

echo "=== CalDAV Calendars ==="
cal events --from "$TODAY_START" --to "$TODAY_END"
```

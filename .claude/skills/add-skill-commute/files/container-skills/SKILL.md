---
name: commute
description: Check travel time and distance between locations using Waze live traffic data. Use for commute times, journey planning, or whenever someone asks how long it takes to get somewhere.
allowed-tools: Bash(curl:*,jq:*,sed:*,python3:*)
---

# Travel Time with Waze

Get live traffic-based travel times using the Waze routing API (no API key needed).

## Two-Step Process

### Step 1: Geocode addresses to coordinates

The geocoding endpoint **requires** `lat` and `lon` parameters (approximate location bias). Without them it returns 500. Use `0`/`0` if you have no idea, or the approximate region center for better results.

```bash
# Geocode an address (use row-SearchServer for EU/UK/AU, SearchServer for US)
curl -s -G "https://www.waze.com/row-SearchServer/mozi" \
  --data-urlencode "q=Oxford, UK" \
  --data-urlencode "lang=eng" \
  --data-urlencode "origin=livemap" \
  --data-urlencode "lat=51.5" \
  --data-urlencode "lon=-0.1" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://www.waze.com/" | jq '.[0] | {name, lat: .location.lat, lon: .location.lon}'
```

### Step 2: Get route with travel time

```bash
# Use coordinates from step 1 (format: x:LONGITUDE y:LATITUDE)
curl -s -G "https://routing-livemap-row.waze.com/RoutingManager/routingRequest" \
  --data-urlencode "from=x:START_LON y:START_LAT" \
  --data-urlencode "to=x:END_LON y:END_LAT" \
  --data-urlencode "at=0" \
  --data-urlencode "returnJSON=true" \
  --data-urlencode "returnGeometries=false" \
  --data-urlencode "returnInstructions=false" \
  --data-urlencode "timeout=60000" \
  --data-urlencode "nPaths=3" \
  --data-urlencode "options=AVOID_TRAILS:t,AVOID_TOLL_ROADS:f,AVOID_FERRIES:f" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://www.waze.com/" | jq '
    # nPaths>1 returns {alternatives: [...]}, nPaths=1 returns {response: ...}
    if .alternatives then
      {routes: [.alternatives[] | {
        name: .response.routeName,
        time_minutes: ([.response.results[].crossTime] | add / 60 | . * 100 | round / 100),
        distance_km: ([.response.results[].length] | add / 1000 | . * 100 | round / 100)
      }]}
    else
      {routes: [{
        name: .response.routeName,
        time_minutes: ([.response.results[].crossTime] | add / 60 | . * 100 | round / 100),
        distance_km: ([.response.results[].length] | add / 1000 | . * 100 | round / 100)
      }]}
    end'
```

## Regional Servers

| Region | Search Server | Routing Server |
|--------|--------------|----------------|
| EU/UK/AU | `www.waze.com/row-SearchServer/mozi` | `routing-livemap-row.waze.com` |
| US/Canada | `www.waze.com/SearchServer/mozi` | `routing-livemap-am.waze.com` |
| Israel | `www.waze.com/il-SearchServer/mozi` | `routing-livemap-il.waze.com` |

Default to EU/UK servers unless the user's location suggests otherwise.

## Route Options

Add to the `options` parameter:
- `AVOID_TOLL_ROADS:t` -- avoid tolls
- `AVOID_FERRIES:t` -- avoid ferries
- `AVOID_TRAILS:t` -- avoid unpaved roads

## Response Parsing

**Routing response structure varies by nPaths:**
- `nPaths=1` returns `{response: {results: [...], routeName: "...", totalRouteTime: N}}`
- `nPaths>1` returns `{alternatives: [{response: {...}}, ...]}`

Each `response.results[]` segment has:
- `crossTime` -- travel time for segment (seconds, includes live traffic)
- `crossTimeWithoutRealTime` -- average time without live traffic
- `length` -- segment distance (meters)
- `totalRouteTime` -- pre-summed total time (seconds) on the response object

Sum all segments for total time/distance, or use `totalRouteTime` directly.

## Important Notes

- **Headers required**: Always include `User-Agent` and `Referer` headers or requests will be blocked
- **lat/lon required for geocoding**: The search endpoint returns 500 without `lat` and `lon` query params. Pass approximate coordinates for the region (e.g., `lat=51.5&lon=-0.1` for UK)
- **NaN values**: Response JSON may contain `NaN` values (currently quoted as `"NaN"` strings). If jq parsing fails, try piping through `sed 's/: *NaN/: "NaN"/g'` before `jq` to fix bare NaN values
- **Coordinates format**: Waze uses `x:longitude y:latitude` (note: longitude first!)
- **nPaths**: Set to 3 to show alternative routes with different times

## Remembering Locations

When the user tells you their home, work, or other frequent locations, save them to your CLAUDE.md memory so you can look up travel times without asking each time. Example format:

```
## Saved Locations
- Home: Oxford, UK (lat: 51.752, lon: -1.258)
- Work: London, UK (lat: 51.507, lon: -0.128)
```

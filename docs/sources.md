# Sources: how it works and why

Technical notes on each source. The short overview is in the [README](../README.md).

| Activity | Where from | Granularity | How it is fetched |
|---|---|---|---|
| 🎮 Games | gowithme.club | daily | `GET /api/player?name=…&period=year&include=byDayGames` → `byDay`, `byDayGames`, `topGames` |
| 🎬 Movies | Letterboxd | daily | RSS + runtime from TMDB by `tmdb:movieId` |
| 📚 Books | KoShelf | daily | `GET /api/reading/calendar?month=…` for months with data |
| 📺 TV shows | myshows | daily | profile export from `data/imports/*.xlsx` + `profile.Feed` |
| 🏃 Workouts | intervals.icu | daily | `GET /api/v1/athlete/{id}/activities?oldest=…&newest=…` |

## Movies

**Letterboxd** sits behind Cloudflare, has no public API, and its RSS only returns the ~50 latest entries. So viewings **accumulate**: every sync appends new items to `entries` by `guid`, and whatever has dropped out of the feed stays in the database. The daily series is rebuilt from the accumulated data, not from the feed.

**Movie runtimes** are cached in `film_runtime` forever: TMDB is only queried for new ids. Without `TMDB_API_KEY`, time is computed from an average runtime (115 min) and marked in the interface as an estimate.

## TV shows

**myshows** does not expose history publicly: `profile.Feed` returns the last 25 check-ins and ignores pagination, while `profile.Episodes` requires auth. So history comes from a **profile export**, and the feed picks up whatever was checked in after it. Both halves name the show by its original title and give the episode number, so the `show|s01e04` key matches and an episode from two sources collapses into one record. If a gap forms between the export date and the feed window, the service says so on screen and asks for a fresh export.

The export goes into `data/imports/` (the newest `.xlsx` is used). The folder is not in the repo: it is personal data. It is mounted as a volume, so it survives container recreation.

## Workouts

**Taken from intervals.icu, not from Garmin.** They land there from the watch on their own, and access is incomparably simpler: HTTP Basic with the literal `API_KEY` as the login and a personal key from Settings → Developer Settings as the password. No OAuth, no account password, and the key is revoked in one click. The whole year arrives in one request.

Time is counted by `moving_time`: it is more honest for "how long did I train". But for strength and yoga it is often zero, so `elapsed_time` is used there.

## Games

**gowithme** recomputes the past retroactively, so the daily series for the year is replaced wholesale rather than appended.

Games come from the opt-in `byDayGames` (a day × game aggregate; the sum matches `byDay`). The raw session log can be fetched from `GET /api/player/sessions` if needed.

## Books

**KoShelf must be reachable over the network**; set its address in `KOSHELF_BASE_URL`. Docker Desktop on a Mac cannot see the local network at all (any LAN port is refused), so there books only sync when running via `npm start`, without a container.

The container's **time zone** must match KoShelf, otherwise reading spills into neighbouring days.

## Data model

Sources deliver different granularity, and forcing them under a common denominator means lying. Hence:

- `daily` / `monthly`: time series; on read, whichever is available is used, and the granularity is visible in the API;
- `entries`: things that have a real date (a movie viewing, an episode);
- `highlights`: tops like "what I played most": such items have no single date and never enter the daily series;
- `sync_state`: source status, including `covers_from`: from which date it has data at all.

`covers_from` is not a technical detail: if a source only knows half a year, that is written on screen next to the total, not implied.

## Configuration

Everything goes through `.env`. No field is required: a blank source is simply switched off, the rest keep working.

| Variable | Purpose |
|---|---|
| `GOWITHME_PLAYER`, `LETTERBOXD_USER`, `MYSHOWS_LOGIN` | nicknames on those services |
| `KOSHELF_BASE_URL` | KoShelf address on the network |
| `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID` | workouts from intervals.icu |
| `TMDB_API_KEY` | exact movie runtimes (without it, an estimate from an average runtime) |

TV show history comes from a myshows profile export: drop the `.xlsx` into `data/imports/`.

The rest (port, year, sync frequency, time zone) is in [`.env.example`](../.env.example) with defaults.

## Export

The **Export** button gives the whole year: JSON with the summary, journal and tops, or a flat CSV for Excel.

## API

| Method | Purpose |
|---|---|
| `GET /api/summary?year=2026` | everything the summary draws |
| `GET /api/journal?year=2026&source=myshows` | day-by-day activity feed, newest first |
| `GET /api/source?id=myshows&year=2026` | one source: full ranking and its feed |
| `GET /api/export?year=2026&format=json` | download everything for the year (summary, journal, tops) |
| `GET /api/export?year=2026&format=csv` | download a flat journal for Excel |
| `POST /api/sync` | manual sync (idempotent: a repeat call joins the one in progress) |
| `GET /api/health` | status and whether a sync is running |

Background sync runs every `SYNC_INTERVAL_MINUTES` (default 1440, i.e. daily) and once on start. It counts from service start, not from midnight: restart at 15:00 and the next sync is at 15:00 the next day.

## Demo mode

`npm run demo` fills the database with a fictional year and never touches the network. It exists for screenshots and so the project can be looked at without creating accounts on five services.

The generator [`src/demo.ts`](../src/demo.ts) is deterministic: the same year yields the same picture, otherwise every screenshot retake would change all the numbers in the README. The demo database lives separately in `data/demo` and does not overwrite the real one. The "Refresh" button in demo regenerates the year instead of polling sources.

Books in the demo "start" on 10 June: that way the screen also shows the incomplete-coverage caveat, which is prominent in the product.

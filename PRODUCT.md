# Product

<!-- impeccable:product-schema 1 -->
<!-- provenance: the user delegated every decision ("decide everything yourself"); no interview was held, every fact below is taken from README.md, the code and the repo configs -->

## Platform

web

## Users

One user, who is also the owner. A personal dashboard, opened at home in a browser on desktop and phone. No guests, roles or sharing.

## Product Purpose

Show on one screen how much of the year went to games, TV shows, movies, books and workouts: the overall total, shares, a monthly chart and a day-by-day feed. Success looks like this: open it, read the picture of the year in seconds, and drill into an activity's details with one click when wanted.

## Positioning

Brings five incompatible sources into one picture of the year without forcing them to lie under a common denominator: each has its own granularity, and it is visible in the interface. Labels the limits of the data honestly (from which date a source keeps records at all) instead of implying them.

## Operating Context

Lives next to its sources: on a home NAS in Docker alongside KoShelf, or locally via `npm start`. Secrets live in `.env` (TMDB, intervals.icu). TV show history arrives as a manual myshows export in `data/imports/*.xlsx`. Background sync runs once a day counted from service start, plus once on start; manual sync is a button and idempotent (a repeat joins the one in progress).

## Capabilities and Constraints

- Sources: gowithme (games, the yearly series is replaced wholesale), Letterboxd (movies, accumulated from an RSS feed of ~50 entries + runtime from TMDB), KoShelf (books, monthly calendar), myshows (TV shows, xlsx export + a feed of 25 check-ins), intervals.icu (workouts, the whole year in one request).
- Without a TMDB key movie time is an estimate from an average runtime; without an intervals key the source is off.
- Data model: `daily`/`monthly` (time series), `entries` (events with a real date), `highlights` (undated tops), `sync_state` (status + `covers_from`).
- Screens: Summary, Journal with an activity filter, single-source card, JSON/CSV export.
- Stack: Node ≥ 24 (26 in production), zero dependencies, SQLite and TypeScript out of the box; static files in `public/`; API without auth, protected only by the local network.
- The container time zone must match KoShelf (Europe/Warsaw), otherwise reading spills into neighbouring days.

## Brand Commitments

The name is YearScope, the mark is `public/logo-mark.svg` (a ring). Voice: calm, precise, no marketing ("hours this year", "days nonstop"). The dark theme is the only one; there is no light theme and none is planned. Emoji serve as activity icons (🎮📺🎬📚🏃); replacing them with an icon font is not required. Each activity has its own accent colour that encodes it everywhere: cards, chart, feed, navigation. No em dashes in copy: a phrase is restructured around a comma, colon or full stop.

## Evidence on Hand

Live database `data/yearscope.db` (year 2026, ~692 h, all five sources sync successfully). Export `data/imports/myshows-export.xlsx`. Real API responses: `GET /api/summary`, `/api/journal`, `/api/source`, `/api/export`, `/api/health`, `POST /api/sync`.

## Product Principles

1. Honesty about coverage beats a pretty number: incomplete data is labelled next to the total, not hidden.
2. Local and private: data lives at home; no accounts, analytics or tracking.
3. Zero maintenance: no build, no dependencies, recreating the container loses nothing (data in the `./data` volume).
4. Sources are not bent to fit each other: differing granularity is shown as is.
5. One screen, one answer: the summary reads in seconds, details are one click away, the export is enough for Excel.

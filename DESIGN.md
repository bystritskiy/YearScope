---
name: YearScope
description: A personal dashboard of the year's time — games, TV shows, movies, books, workouts.
colors:
  bg: "#0b0e14"
  bg-raised: "#141922"
  bg-sunken: "#090c11"
  line: "#232a36"
  text: "#e6eaf2"
  text-dim: "#8b93a5"
  text-faint: "#79839a"
  warn: "#e0a33a"
  error: "#e05a5a"
  accent-games: "#7c5cff"
  accent-series: "#31b0d5"
  accent-films: "#40bf6a"
  accent-books: "#e0913a"
  accent-workouts: "#e05a8a"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "52px"
    fontWeight: 680
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 550
rounded:
  xs: "5px"
  sm: "9px"
  md: "14px"
  pill: "999px"
spacing:
  container: "1180px"
  section: "20px"
  card-gap: "14px"
components:
  button:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
  button-hover:
    backgroundColor: "#1c2330"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
  nav-tab:
    backgroundColor: "transparent"
    textColor: "{colors.text-dim}"
    padding: "8px 14px 10px"
  nav-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "8px 14px 10px"
  chip:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.pill}"
    padding: "6px 13px"
  card:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "16px 18px"
---

# Design System: YearScope

## Overview

**Creative North Star: "The Honest Ledger"**

YearScope is a quiet ledger of time, not a storefront. Dark, dense, calm: one screen answers "where did the year go", and not a single pixel pretends to be more precise than the data underneath. The five accent colours are not decoration but a coding system: every activity is recognised by its colour in the card, the chart column, the feed and the navigation. Typography is the system font, digits are always tabular. There is almost no motion: the interface should feel like an instant tool, not a performance.

**Key Characteristics:**
- One dark theme, locked via `color-scheme: dark`.
- Accent colour = source identity, applied the same way everywhere.
- Flat surfaces with tonal layering instead of shadows.
- Tabular digits and a restrained heading scale (52 / 40 / 30 / 24).
- States come first: loading, empty, error and data caveats are part of the composition, not patches.

## Colors

The palette is cool graphite neutrals with five muted source accents; two warning colours (amber, red).

### Primary

There is no single primary accent: the accent role is spread across the source colours (see Tertiary). Neutral text `#e6eaf2` is the closest thing to a primary for interactive elements.

### Tertiary

- **Games, violet** (#7c5cff): cards, chart, feed, navigation, everything related to gowithme.
- **TV shows, cyan** (#31b0d5): the same for myshows.
- **Movies, green** (#40bf6a): the same for letterboxd.
- **Books, amber-orange** (#e0913a): the same for koshelf.
- **Workouts, raspberry** (#e05a8a): the same for intervals.

### Neutral

- **Background** (#0b0e14): the page and sunken areas.
- **Raised surface** (#141922): cards, panels, buttons, feed days.
- **Sunken surface** (#090c11): the track under share bars and the footer.
- **Line** (#232a36): 1px borders, dividers, inactive states.
- **Text** (#e6eaf2): headings, values, primary content.
- **Dim text** (#8b93a5): labels, shares, secondary content.
- **Faint text** (#79839a): 10–12px meta (update stamp, tags). The lower bound of WCAG AA contrast (5.1:1 against the background): it cannot go lighter without losing hierarchy, nor darker per the standard.
- **Warning** (#e0a33a): incomplete-data caveats.
- **Error** (#e05a5a): sync errors.

### Named Rules

**The Stripe Rule.** A source's accent appears as a thin top stripe (2–3px) on its card and detail header, and as segments in share bars and chart columns. The stripe is a label, not an ornament: never move it onto neutral surfaces.
**The Darkness Lock.** There is no light theme. New surfaces are designed only in the dark tokens above; inverting a section is forbidden.

## Typography

**Display Font:** system sans (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial) (no web fonts: zero dependencies)
**Body Font:** the same system sans
**Label/Mono Font:** none separate; digits use the system font with `font-variant-numeric: tabular-nums`

**Character:** a neutral system voice; confidence comes from weight and size, not from the typeface's personality. Emoji are the standard activity icons, not decoration.

### Hierarchy

- **Display** (680, 52px/1, -0.03em): the total hours for the year. Summary only.
- **Headline** (680, 24px/1.2, -0.02em): the page title (`#page-title`).
- **Title** (650, 30px/1, -0.02em): hours on an activity card; (660, 40px): hours in the source detail header.
- **Body** (400, 15px/1.5): feed, descriptions, footer.
- **Label** (550, 13px, dim): panel titles; (400, 11–12px, faint): meta, month labels, update stamp.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow appears only on elements detached from the flow (menus, the floating button). Cards and panels have no shadows; they have a 1px border.

## Shapes

One scale with a documented rule: surfaces are 14px (cards, panels, days), controls are 9px (buttons, menus), small interactive elements are 999px pills (chips, the year badge), micro details are 5–6px (chart segments, menu items). The share bar and its segments are a pill with overflow hidden. Mixing scales outside the rule is forbidden.

## Components

### Buttons

- **Shape:** 9px, 1px line border.
- **Primary:** raised-surface background, primary text, padding 8px 15px, 13px font.
- **Hover / Focus:** background `#1c2330`, border `#2f3847`. Focus is a visible ring from the palette.
- **Disabled:** opacity 0.5, default cursor (the sync button while polling).

### Navigation

- **Style:** 14px text tabs in dim text, the active one in primary text with a 2px underline; source links are the same 13px tabs with a coloured identifier dot (7px, source accent).
- **Placement:** sticky header with blur (a frosted-glass approximation, not Apple Liquid Glass), brand on the left, actions on the right.
- **Mobile:** tabs drop to a row below with horizontal scroll and no visible scrollbar.

### Chips

- **Style:** pill, raised-surface background, line border, 13px dim text.
- **State:** active is filled with the source accent (`--chip-accent`), transparent border, white text.

### Cards / Containers

- **Corner Style:** 14px.
- **Background:** raised surface; a 2px top stripe in the source accent (see The Stripe Rule).
- **Shadow Strategy:** none (see Flat-By-Default).
- **Border:** 1px line; a clickable card highlights with the accent and lifts 2px on hover.
- **Affordance:** a clickable card carries the line "Open the full year →" in 12px dim text; an empty card has a dashed border and a label with the reason.
- **Internal Padding:** 16px 18px.

### Chart

Stacked columns for 12 months, height is a share of the maximum (150px), segments are source colours with "source: exact time" tooltips. Above the chart is a legend row "colour = source". Every column is a `role="img"` with the label "month: total, shares", and the total bar is labelled too. An empty month is a flat 4px track. Month values are always visible, including on narrow screens.

### Journal feed

A day is a 14px panel: date + weekday on the left, exact total on the right; events are an "icon / body / time" grid. Aggregate events (`kind: day`) are dimmed. An empty feed shows a centred label, not a void.

### Detail + Ranking

The source header is a panel with a 3px accent stripe; the ranking is a numbered list with a weight bar relative to the first row. The "← back to summary" button is a plain dim text button.

### Gaps (data caveats)

A bulletless list by default: an amber marker is a warning, a red one is an error; the source label is semibold primary text. The panel is hidden when there are no caveats.

### Footer

Two columns without a bottom bar: on the left the mark + name with a version badge (`v1.0.0` from `package.json`, served in `summary.version`), a description and the year's total; on the right the data (download JSON/CSV, refresh). The update stamp lives only in the header, there is no duplicate line in the footer. Back to top is only the floating button.

## Logo

The mark is a "ring of the year": a circle of five segments in the source colours (clockwise from the top: games, TV shows, movies, books, workouts) with a crosshair dot in the centre. The segments are the same five palette accents; there is no sixth colour and no gradients.

- `public/logo-mark.svg`: the mark without background: header (24px), footer (18px).
- `public/favicon.svg`: the mark on a `bg-raised` plate with a `line` outline: favicon, apple-touch-icon.
- `public/logo.svg`: horizontal lockup, mark + YearScope in light text: dark surfaces, OG image.
- `public/logo-light.svg`: the same lockup in dark text `#161b26`: light surfaces (README header).

### Named Rules

**The Logo Lock.** Segments are never recoloured, the colour order never changes, the dot takes the surface's text colour. The mark is never combined with other shapes or placed on photos.

## Do's and Don'ts

### Do:

- **Do** encode a source with its accent everywhere it appears.
- **Do** label incomplete data next to the number (caveat panel, `covers_from`).
- **Do** keep digits tabular and time exact (`81 h 38 min`); rounding to hours is only for big totals.
- **Do** hide panels entirely (`hidden`) when there is no data for them, instead of placeholders.

### Don't:

- **Don't** introduce a sixth accent colour or a gradient: the palette is closed at five source colours plus neutrals.
- **Don't** rebuild copy around em dashes: phrases are restructured with a comma, colon or full stop.
- **Don't** add a light theme, modals or endless animations: they do not exist in the product's world.
- **Don't** nest cards inside cards or give flat surfaces shadows.
- **Don't** show tops (`highlights`) as feed events: they have no date.

<div align="center">

# Room TBA UPD

**Saan sa UP Diliman ang \___?**

[![MIT](https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/bun-1.3+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Astro](https://img.shields.io/badge/Astro-7-BC52EE?style=flat-square&logo=astro)](https://astro.build)

_An open-source room finder and campus map for UP Diliman, forked from [uplbtools/room-tba](https://github.com/uplbtools/room-tba)._

</div>

---

## What this is

**Room TBA UPD** is a map-first web app for [UP Diliman](https://upd.edu.ph) students. You search a room code, building nickname, or course; the app puts it on an interactive campus map, shows schedules when we have them, and keeps working when the signal drops.

No account needed to browse. Editors and contributors fix data in the same app (login popup on the map, not a separate admin site).

> **Data note:** Room and class listings are updated each term by volunteers. Class search lists lecture, lab, thesis, special problem, and similar sections; ones without a room in CRS show as unassigned. Room schedules list only lecture and lab sections with assigned rooms. Wrong schedule? [Open an issue](https://github.com/smmariquit/room-tba-upd/issues/new/choose).

## What you can do

- Search rooms, buildings, dorms, orgs, offices, and landmarks (aliases included)
- Room schedules by term, class browsing by course code
- Plan a draft schedule in the Planner; see your day in the Today view (`/today`)
- Building locations with pins, directions, and shareable links
- Jeepney route overlays
- Works offline (PWA + local cache; tiles if already loaded)

## Stack

[Astro 7](https://astro.build) + [Svelte 5](https://svelte.dev), [Bun](https://bun.sh), Postgres + [Drizzle](https://orm.drizzle.team), [PGlite](https://pglite.dev) for offline data, [MapLibre GL](https://maplibre.org) with OSM / MapTiler tiles.

## Run it locally

You need [Bun](https://bun.sh) 1.3+ and a Postgres `DATABASE_URL` (Supabase works).

```sh
bun install
cp .env.example .env
# fill DATABASE_URL in .env

bunx drizzle-kit push
bun run scripts/seed-upd-campus.ts
bun run import:crs-classes -- --term-id 120261 --fetch
bun dev
```

Open **http://localhost:4321**.

### Commands worth knowing

| Command | Does what |
| --- | --- |
| `bun dev` | Dev server |
| `bun run build` | Production build (needs `DATABASE_URL`) |
| `bun run test` | Unit + component tests |
| `bun run lint` | Biome check (format + lint) |
| `bun run fork:check` | Scan for leftover UPLB strings inherited from upstream |

## Credits and license

Forked from **[uplbtools/room-tba](https://github.com/uplbtools/room-tba)**, originally built for UPLB by [UPLB Tools](https://github.com/uplbtools) and maintained by [Simonee Ezekiel Mariquit](https://stimmie.dev) and contributors. Not an official UP Diliman product.

| Layer | License |
| --- | --- |
| Application code | [MIT](LICENSE) |
| Community campus map data (buildings, rooms, dorms, orgs, pins, aliases) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| OpenStreetMap basemap / footprints | [ODbL](https://www.openstreetmap.org/copyright) (+ [MapTiler](https://www.maptiler.com/copyright/) for tiles) |
| CRS, OUR, and similar registrar imports | Not offered under an open bulk license |

Use the code, fork it, teach with it. If you deploy a fork for another campus, change the data, not just the logo: see the upstream [fork guide](https://room-tba.uplb.tools/wiki/fork-for-your-campus).

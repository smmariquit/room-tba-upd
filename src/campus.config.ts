/**
 * Single source of truth for campus-specific config.
 *
 * This fork targets UP Diliman. Data comes from the public CRS schedule
 * browser (crs.upd.edu.ph/schedule) and OpenStreetMap.
 * Run `bun run fork:check` after editing to catch stray UPLB strings.
 *
 * Values are plain literals so astro.config.mjs can import this module at
 * config-eval time (no process.env reads at module top level).
 */

export const campusSite = {
  // Placeholder until a real domain is picked.
  url: "https://room-tba-upd.vercel.app",
  name: "Room TBA",
  title: "Room TBA | Find Rooms, Buildings, and Colleges at UP Diliman",
  description:
    "Room TBA helps UP Diliman students find rooms, buildings, and colleges across the Diliman campus.",
} as const;

export const campusMap: {
  maxBounds: [[number, number], [number, number]];
  defaultCamera: {
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
  };
} = {
  /** [lng, lat]: west/south corner, then east/north corner. */
  maxBounds: [
    // Campus footprint from OSM (121.045-121.076, 14.637-14.663) plus margin
    // for Katipunan, Philcoa, and the Commonwealth edge.
    [121.025, 14.617],
    [121.096, 14.683],
  ],
  /** Default camera: center [lng, lat], zoom, pitch (0 = top-down, 60 = tilted 3D), bearing. */
  defaultCamera: {
    // Academic Oval, between Quezon Hall and the Sunken Garden.
    center: [121.0672, 14.6544],
    zoom: 15.2,
    pitch: 60,
    bearing: 0,
  },
};

export const campusCommunity = {
  // ponytail: all community links point at the repo until a UPD community
  // exists; replace with real Discord/Messenger links when they do.
  orgUrl: "https://github.com/smmariquit/room-tba-upd",
  githubUrl: "https://github.com/smmariquit/room-tba-upd",
  discordUrl: "https://github.com/smmariquit/room-tba-upd",
  osaOrganizationsUrl: "https://upd.edu.ph/organizations/",
  /** Messenger group chat invites (targets for redirect workers). */
  messengerContributeTarget: "https://github.com/smmariquit/room-tba-upd",
  messengerMaintainTarget: "https://github.com/smmariquit/room-tba-upd",
  /** Short links on a community subdomain (Cloudflare Worker). Delete if unused. */
  messengerShortContributeUrl: "https://github.com/smmariquit/room-tba-upd",
  messengerShortMaintainUrl: "https://github.com/smmariquit/room-tba-upd",
} as const;

import type { APIRoute } from "astro";
import { sql } from "drizzle-orm";
import { db } from "@lib/db";
import { presenceTable } from "@drizzle/schema";

export const prerender = false;

/** Sessions seen within this window count as online. */
const ONLINE_WINDOW_SECONDS = 90;

/**
 * Presence heartbeat: the client POSTs its random session id every 30s and
 * gets back the number of distinct sessions seen in the last 90s. Session ids
 * are client-generated UUIDs, never tied to an account.
 */
export const POST: APIRoute = async ({ request }) => {
  let sid: unknown;
  try {
    ({ sid } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), {
      status: 400,
    });
  }
  if (typeof sid !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(sid)) {
    return new Response(JSON.stringify({ error: "invalid sid" }), {
      status: 400,
    });
  }

  await db
    .insert(presenceTable)
    .values({ sid })
    .onConflictDoUpdate({
      target: presenceTable.sid,
      set: { lastSeenAt: sql`now()` },
    });

  // Opportunistic prune so the table stays tiny.
  if (Math.random() < 0.1) {
    await db
      .delete(presenceTable)
      .where(sql`${presenceTable.lastSeenAt} < now() - interval '10 minutes'`);
  }

  const [row] = await db
    .select({ online: sql<number>`count(*)::int` })
    .from(presenceTable)
    .where(
      sql`${presenceTable.lastSeenAt} > now() - make_interval(secs => ${ONLINE_WINDOW_SECONDS})`,
    );

  return new Response(JSON.stringify({ online: row?.online ?? 1 }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};

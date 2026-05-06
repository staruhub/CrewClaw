import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { waitlist } from "../../db/schema";

export const waitlistRouter = createRouter({
  subscribe: publicQuery
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().optional(),
        plan: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(waitlist).values({
        email: input.email,
        name: input.name || null,
        plan: input.plan || null,
      });
      return { success: true };
    }),
});

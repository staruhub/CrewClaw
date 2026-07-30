import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { waitlist } from "../../db/schema";
import { assertPublicFormAllowed } from "../lib/public-form-guard";

export const waitlistInputSchema = z.object({
  email: z.string().max(255).email(),
  name: z.string().trim().min(1).max(255).optional(),
  plan: z.string().trim().min(1).max(50).optional(),
});

export function waitlistDuplicateUpdate(
  input: z.infer<typeof waitlistInputSchema>
) {
  return {
    email: input.email,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.plan !== undefined ? { plan: input.plan } : {}),
  };
}

export const waitlistRouter = createRouter({
  subscribe: publicQuery
    .input(waitlistInputSchema)
    .mutation(async ({ input, ctx }) => {
      assertPublicFormAllowed(ctx, "waitlist");
      const db = getDb();
      await db
        .insert(waitlist)
        .values({
          email: input.email,
          name: input.name || null,
          plan: input.plan || null,
        })
        .onDuplicateKeyUpdate({
          // Keep previously captured optional fields when a retry only supplies the unique email.
          set: waitlistDuplicateUpdate(input),
        });
      return { success: true };
    }),
});

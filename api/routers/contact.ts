import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { contacts } from "../../db/schema";
import { assertPublicFormAllowed } from "../lib/public-form-guard";

export const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().max(255).email(),
  message: z.string().max(2000).optional(),
});

export const contactRouter = createRouter({
  submit: publicQuery
    .input(contactInputSchema)
    .mutation(async ({ input, ctx }) => {
      assertPublicFormAllowed(ctx, "contact");
      const db = getDb();
      await db.insert(contacts).values({
        name: input.name,
        email: input.email,
        message: input.message || null,
      });
      return { success: true };
    }),
});

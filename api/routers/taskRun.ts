import { z } from "zod";
import { loadTaskRun } from "../lib/task-run-store";
import { createRouter, localQuery } from "../middleware";

export const taskRunRouter = createRouter({
  get: localQuery
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return loadTaskRun(input.id);
    }),
});

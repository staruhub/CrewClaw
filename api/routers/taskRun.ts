import { z } from "zod";
import { loadTaskRun } from "../lib/task-run-store";
import { createRouter, publicQuery } from "../middleware";

export const taskRunRouter = createRouter({
  get: publicQuery
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return loadTaskRun(input.id);
    }),
});

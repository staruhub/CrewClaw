import { createRouter, publicQuery } from "./middleware";
import { waitlistRouter } from "./routers/waitlist";
import { contactRouter } from "./routers/contact";
import { taskRunRouter } from "./routers/taskRun";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  waitlist: waitlistRouter,
  contact: contactRouter,
  taskRun: taskRunRouter,
});

export type AppRouter = typeof appRouter;

import { createRouter, publicQuery } from "./middleware";
import { waitlistRouter } from "./routers/waitlist";
import { contactRouter } from "./routers/contact";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  waitlist: waitlistRouter,
  contact: contactRouter,
});

export type AppRouter = typeof appRouter;

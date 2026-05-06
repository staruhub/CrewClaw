import { drizzle } from "drizzle-orm/mysql2";
import { requireEnv } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

export function getDb() {
  if (!instance) {
    instance = drizzle(requireEnv("databaseUrl"), {
      mode: "planetscale",
      schema: fullSchema,
    });
  }
  return instance;
}

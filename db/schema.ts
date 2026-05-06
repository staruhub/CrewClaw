import {
  mysqlTable,
  serial,
  varchar,
  timestamp,
} from "drizzle-orm/mysql-core";

export const waitlist = mysqlTable("waitlist", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  plan: varchar("plan", { length: 50 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const contacts = mysqlTable("contacts", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  message: varchar("message", { length: 2000 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

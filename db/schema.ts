import { mysqlTable, serial, varchar, timestamp } from "drizzle-orm/mysql-core";

export const contacts = mysqlTable("contacts", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  message: varchar("message", { length: 2000 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

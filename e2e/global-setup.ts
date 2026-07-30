import { seedTaskRunFixture } from "./task-run-fixture";

export default async function globalSetup() {
  const root = process.env.CREWCLAW_ROOT;
  if (!root) {
    throw new Error("Browser E2E requires CREWCLAW_ROOT");
  }
  await seedTaskRunFixture(root);
}

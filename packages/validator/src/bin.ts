import { validateAllExperts, validateExpert } from "./index";

async function main() {
  const [first, second] = process.argv.slice(2);
  const result =
    first === "--all"
      ? await validateAllExperts()
      : await validateExpert(first ?? second ?? "");
  const results = "results" in result ? result.results : [result];

  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.name}`);
    for (const warning of entry.warnings) console.log(`  warning: ${warning}`);
    for (const error of entry.errors) console.error(`  error: ${error}`);
  }

  if (!result.ok) process.exit(1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import { closeDatabase } from "./db.js";
import { importLegacySnapshot, readLegacySnapshot } from "./migration.js";
import { parseMigrationArguments } from "./migration-cli.js";

try {
  const options = parseMigrationArguments(process.argv.slice(2));
  const snapshot = await readLegacySnapshot(options.input);
  const result = await importLegacySnapshot(snapshot, options.apply);
  console.log(JSON.stringify({ mode: options.apply ? "apply" : "dry-run", ...result }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "A migração falhou.");
  process.exitCode = 2;
} finally {
  await closeDatabase();
}

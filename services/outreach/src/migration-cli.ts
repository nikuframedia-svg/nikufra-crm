import { HttpError } from "./errors.js";

export interface MigrationCliOptions {
  input: string;
  apply: boolean;
}

function valueAfter(args: string[], index: number, option: string) {
  const next = args[index + 1];
  if (!next || next.startsWith("--")) throw new HttpError(400, "migration_input_missing", `${option} exige um caminho.`);
  return next;
}

export function parseMigrationArguments(args: string[]): MigrationCliOptions {
  let input = "";
  let apply = false;
  let explicitDryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--apply") apply = true;
    else if (argument === "--dry-run") explicitDryRun = true;
    else if (argument === "--input" || argument === "--file") {
      input = valueAfter(args, index, argument);
      index += 1;
    } else if (argument.startsWith("--input=") || argument.startsWith("--file=")) {
      input = argument.slice(argument.indexOf("=") + 1);
    } else {
      throw new HttpError(400, "migration_argument_invalid", `Opção de migração desconhecida: ${argument.split("=")[0]}`);
    }
  }
  if (!input.trim()) throw new HttpError(400, "migration_input_missing", "Indica o snapshot com --input /caminho/snapshot.json.");
  if (apply && explicitDryRun) throw new HttpError(400, "migration_mode_conflict", "Escolhe apenas --dry-run ou --apply.");
  return { input, apply };
}

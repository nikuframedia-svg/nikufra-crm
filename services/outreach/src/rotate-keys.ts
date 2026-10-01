import { closeDatabase } from "./db.js";
import { rotateCredentialKeys } from "./rotation.js";

const apply = process.argv.includes("--apply");
try {
  console.log(JSON.stringify(await rotateCredentialKeys(apply), null, 2));
} finally {
  await closeDatabase();
}

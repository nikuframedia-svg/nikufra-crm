import { readFile, writeFile } from "node:fs/promises";

const configPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const publicKey = process.env.UPDATER_PUBKEY;
if (!publicKey) throw new Error("TAURI_UPDATER_PUBKEY não está definido");
const config = JSON.parse(await readFile(configPath, "utf8"));
config.plugins.updater.pubkey = publicKey;
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

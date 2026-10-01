#!/usr/bin/env node
import { createDecipheriv } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("NOUTBK1\0");
const HEADER_BYTES = MAGIC.length + 12;
const TAG_BYTES = 16;

function absoluteArgument(index, label) {
  const value = process.argv[index];
  if (!value || !isAbsolute(value)) throw new Error(`${label} tem de ser um caminho absoluto.`);
  return value;
}

const archivePath = await realpath(absoluteArgument(2, "O arquivo"));
const keyPath = await realpath(absoluteArgument(3, "A chave"));
const keyInfo = await lstat(keyPath);
if (!keyInfo.isFile() || keyInfo.isSymbolicLink() || (keyInfo.mode & 0o077) !== 0) {
  throw new Error("A chave tem de ser um ficheiro normal privado (0600), não um symlink.");
}
const archiveInfo = await stat(archivePath);
if (!archiveInfo.isFile() || archiveInfo.size <= HEADER_BYTES + TAG_BYTES) throw new Error("Arquivo Outreach inválido.");

const key = Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64");
if (key.length !== 32) throw new Error("A chave de backup não contém 32 bytes.");
const handle = await open(archivePath, "r");
try {
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  const first = await handle.read(header, 0, header.length, 0);
  const last = await handle.read(tag, 0, tag.length, archiveInfo.size - TAG_BYTES);
  if (first.bytesRead !== HEADER_BYTES || last.bytesRead !== TAG_BYTES || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Envelope de backup Outreach inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  await pipeline(
    createReadStream(archivePath, { start: HEADER_BYTES, end: archiveInfo.size - TAG_BYTES - 1 }),
    decipher,
    process.stdout,
  );
} finally {
  await handle.close();
  key.fill(0);
}

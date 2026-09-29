function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function utf8Chunks(value: string, maximumBytes = 45) {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).length;
    if (current && currentBytes + characterBytes > maximumBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function encodeMimeHeader(value: string) {
  const sanitized = sanitizeHeader(value);
  if (/^[\x20-\x7E]*$/.test(sanitized)) return sanitized;
  const encoder = new TextEncoder();
  return utf8Chunks(sanitized)
    .map((chunk) => `=?UTF-8?B?${bytesToBase64(encoder.encode(chunk))}?=`)
    .join("\r\n ");
}

export function encodeMimeTextBody(value: string) {
  const base64 = bytesToBase64(new TextEncoder().encode(value));
  return base64.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export function base64UrlUtf8(value: string) {
  return bytesToBase64(new TextEncoder().encode(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

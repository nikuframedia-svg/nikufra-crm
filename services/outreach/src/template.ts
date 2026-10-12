// A recipient name in the final signature line would make the sender sign
// with the contact's name. Keep the rule narrow so greetings remain valid.
export function recipientNameInSignature(body: string): boolean {
  const lastLine = body.trimEnd().split(/\r?\n/).at(-1)?.trim() ?? "";
  return /^(?:[-–—]\s*)?\{\{\s*(?:nome|name|first_name|primeiro_nome)\s*\}\}$/i.test(lastLine);
}

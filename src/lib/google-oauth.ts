import { supabase } from "./supabase";

export interface GoogleImportPreview {
  messagesFound: number;
  contactsFound: number;
  contactsExisting: number;
  contactsNew: number;
}

export async function startGoogleOAuth() {
  if (!supabase) throw new Error("A API do servidor não está configurada.");
  const { data, error } = await supabase.functions.invoke("gmail-oauth-start", { body: {} });
  if (error || !data?.url) throw new Error(error?.message ?? "Não foi possível iniciar a autorização Google.");
  window.location.assign(data.url);
}

export async function previewGoogleImport(): Promise<GoogleImportPreview> {
  if (!supabase) throw new Error("A API do servidor não está configurada.");
  const { data, error } = await supabase.functions.invoke("gmail-import-preview", { body: {} });
  if (error) throw new Error(error.message);
  return data as GoogleImportPreview;
}

export async function confirmGoogleImport() {
  if (!supabase) throw new Error("A API do servidor não está configurada.");
  const { error } = await supabase.functions.invoke("gmail-import-confirm", { body: {} });
  if (error) throw new Error(error.message);
  const { error: syncError } = await supabase.functions.invoke("gmail-sync", { body: {} });
  if (syncError) throw new Error(syncError.message);
}

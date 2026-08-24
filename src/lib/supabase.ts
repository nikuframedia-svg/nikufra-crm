import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const supabase = url && anonKey ? createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isTauri },
}) : null;

export type AppDeepLink = "auth" | "gmail" | null;

export async function consumeAppDeepLink(value: string): Promise<AppDeepLink> {
  const deepLink = new URL(value);
  if (deepLink.protocol !== "nikufra-crm:") return null;

  if (deepLink.hostname === "oauth" && deepLink.pathname === "/google") {
    if (deepLink.searchParams.get("status") === "connected") return "gmail";
    throw new Error(deepLink.searchParams.get("error") ?? "Não foi possível ligar o Gmail.");
  }

  if (deepLink.hostname !== "auth" || !supabase) return null;
  const fragment = new URLSearchParams(deepLink.hash.replace(/^#/, ""));
  const accessToken = fragment.get("access_token") ?? deepLink.searchParams.get("access_token");
  const refreshToken = fragment.get("refresh_token") ?? deepLink.searchParams.get("refresh_token");
  const errorMessage = fragment.get("error_description") ?? deepLink.searchParams.get("error_description");
  if (errorMessage) throw new Error(errorMessage);
  if (!accessToken || !refreshToken) throw new Error("O magic link não contém uma sessão válida.");

  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw error;
  return "auth";
}

export async function requestMagicLink(email: string) {
  if (!email.toLowerCase().endsWith("@nikufra.ai")) {
    throw new Error("Usa um endereço @nikufra.ai.");
  }
  if (!supabase) return { local: true };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: isTauri ? "nikufra-crm://auth/callback" : window.location.origin },
  });
  if (error) throw error;
  return { local: false };
}

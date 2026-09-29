import { createClient } from "@supabase/supabase-js";
import { createRememberedAuthStorage } from "./auth-storage";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const authStorage = typeof window !== "undefined"
  ? createRememberedAuthStorage(window.localStorage, window.sessionStorage)
  : undefined;

export const supabase = typeof window !== "undefined" && url && anonKey ? createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    experimental: { appendPkceFlowIdToRedirects: true },
    storage: authStorage,
  },
}) : null;

export async function requestMagicLink(email: string) {
  if (!supabase) return { local: true };
  const redirectTo = window.location.pathname === "/oauth/consent"
    ? window.location.href.split("#")[0]
    : window.location.origin;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: false,
    },
  });
  if (error) throw error;
  return { local: false };
}

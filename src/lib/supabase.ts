import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = typeof window !== "undefined" && url && anonKey ? createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    experimental: { appendPkceFlowIdToRedirects: true },
  },
}) : null;

export async function requestMagicLink(email: string) {
  if (!supabase) return { local: true };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
      shouldCreateUser: false,
    },
  });
  if (error) throw error;
  return { local: false };
}

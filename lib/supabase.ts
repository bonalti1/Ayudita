import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export function createSupabaseBrowserClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Missing Supabase public environment variables.");
  }

  return createClient(env.supabaseUrl, env.supabaseAnonKey);
}

export function createSupabaseServiceClient() {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error("Missing Supabase service environment variables.");
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
}

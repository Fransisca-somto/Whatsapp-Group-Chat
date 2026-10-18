// Public Supabase settings (architecture.md §8). Referenced by full name so Next.js inlines them
// into the browser bundle.
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to apps/dashboard/.env.local and fill them in.",
    );
  }
  return { url, anonKey };
}

export function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.local.example to .env.local and fill in values from the Supabase dashboard.`,
    );
  }
  return value;
}

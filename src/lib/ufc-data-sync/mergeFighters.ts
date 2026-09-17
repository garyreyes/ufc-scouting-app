import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * M3: thin wrapper around the `merge_fighters` DB function
 * (0045_fighter_aliases_and_merge.sql) -- all the actual judgment
 * (which side survives, whether the merge is even allowed) lives in
 * decideSameCardMerge.ts; this just calls the RPC with its decision.
 * Restricted to service_role at the database level (see that migration's
 * own comment on why), so this must always be called with the admin
 * client, never the public one.
 */
export async function mergeFighters(supabase: SupabaseClient, keepId: string, dropId: string): Promise<void> {
  const { error } = await supabase.rpc("merge_fighters", { p_keep_id: keepId, p_drop_id: dropId });
  if (error) throw error;
}

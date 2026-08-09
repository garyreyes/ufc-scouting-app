import { createClient } from "@/lib/supabase/server";
import { isInvalidIdError } from "@/lib/isInvalidIdError";
import type { Clan, ClanWithDetail } from "./types";

// RLS already scopes these to "clans the current session's user belongs
// to" -- no explicit user_id filter needed in the query itself.

export async function getMyClans(): Promise<Clan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("clans").select("id, name, created_by").order("name");
  if (error) throw error;
  return data;
}

export async function getClanById(id: string): Promise<ClanWithDetail | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: clan, error: clanError } = await supabase
    .from("clans")
    .select("id, name, created_by")
    .eq("id", id)
    .maybeSingle();
  if (clanError) {
    if (isInvalidIdError(clanError)) return null;
    throw clanError;
  }
  if (!clan) return null;

  const { data: memberRows, error: membersError } = await supabase
    .from("clan_members")
    .select("user_id, joined_at, profiles:user_id(display_name)")
    .eq("clan_id", id);
  if (membersError) throw membersError;

  const members = (
    memberRows as unknown as {
      user_id: string;
      joined_at: string;
      profiles: { display_name: string | null } | null;
    }[]
  ).map((row) => ({
    user_id: row.user_id,
    joined_at: row.joined_at,
    display_name: row.profiles?.display_name ?? null,
  }));

  const isOwner = user?.id === clan.created_by;

  const invites = isOwner
    ? await (async () => {
        const { data, error } = await supabase
          .from("clan_invites")
          .select("id, token, created_at, revoked")
          .eq("clan_id", id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data;
      })()
    : [];

  return { ...clan, members, invites, isOwner };
}

export async function getInviteClanName(token: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invite_clan_name", { _token: token });
  if (error) throw error;
  return data;
}

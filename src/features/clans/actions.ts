"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

export async function createClan(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Clan name is required");

  // Generate the id ourselves and insert without .select() (no RETURNING).
  // Postgres RLS requires a just-inserted row to also pass the table's
  // SELECT policy before RETURNING can hand it back -- but the SELECT
  // policy here is is_clan_member(id), which is false until the very next
  // insert (clan_members) runs. Requesting the row back between the two
  // inserts fails with "violates row-level security policy" even though
  // the INSERT's own WITH CHECK passed fine. Knowing the id upfront
  // avoids needing RETURNING at all.
  const clanId = randomUUID();

  const { error } = await supabase.from("clans").insert({ id: clanId, name, created_by: user.id });
  if (error) throw error;

  // Creator counts as the clan's first member too.
  const { error: memberError } = await supabase
    .from("clan_members")
    .insert({ clan_id: clanId, user_id: user.id });
  if (memberError) throw memberError;

  redirect(`/clans/${clanId}`);
}

export async function createInvite(clanId: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("clan_invites")
    .insert({ clan_id: clanId, created_by: user.id });
  if (error) throw error;
  revalidatePath(`/clans/${clanId}`);
}

export async function revokeInvite(inviteId: string, clanId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("clan_invites").update({ revoked: true }).eq("id", inviteId);
  if (error) throw error;
  revalidatePath(`/clans/${clanId}`);
}

export async function leaveClan(clanId: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("clan_members")
    .delete()
    .eq("clan_id", clanId)
    .eq("user_id", user.id);
  if (error) throw error;
  redirect("/clans");
}

export async function acceptInvite(token: string) {
  const { supabase } = await requireUser();
  const { data: clanId, error } = await supabase.rpc("accept_clan_invite", { _token: token });
  if (error) throw error;
  redirect(`/clans/${clanId}`);
}

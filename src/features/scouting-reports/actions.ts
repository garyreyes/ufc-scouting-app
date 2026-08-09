"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ReportVisibility } from "./types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

// RLS also enforces this (0010_fix_report_share_clan_membership.sql), but
// filtering here first means a tampered clanIds list never reaches the
// database as a rejected write -- it's just silently dropped from the
// share list instead.
async function keepOnlyOwnClans(
  supabase: SupabaseServerClient,
  userId: string,
  clanIds: string[],
): Promise<string[]> {
  if (clanIds.length === 0) return [];
  const { data, error } = await supabase
    .from("clan_members")
    .select("clan_id")
    .eq("user_id", userId)
    .in("clan_id", clanIds);
  if (error) throw error;
  return data.map((row) => row.clan_id);
}

export async function createReport(formData: FormData) {
  const { supabase, user } = await requireUser();

  const fightId = String(formData.get("fightId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "PRIVATE") as ReportVisibility;
  const clanIds = await keepOnlyOwnClans(supabase, user.id, formData.getAll("clanIds").map(String));

  if (!fightId || !body) throw new Error("Missing fight or report body");

  const { data: report, error } = await supabase
    .from("scouting_reports")
    .insert({ fight_id: fightId, user_id: user.id, body, visibility })
    .select("id")
    .single();
  if (error) throw error;

  if (visibility === "SPECIFIC_CLANS" && clanIds.length > 0) {
    const { error: sharesError } = await supabase
      .from("report_clan_shares")
      .insert(clanIds.map((clanId) => ({ report_id: report.id, clan_id: clanId })));
    if (sharesError) throw sharesError;
  }

  revalidatePath(`/fights/${fightId}`);
}

export async function updateReport(reportId: string, fightId: string, formData: FormData) {
  const { supabase, user } = await requireUser();

  const body = String(formData.get("body") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "PRIVATE") as ReportVisibility;
  const clanIds = await keepOnlyOwnClans(supabase, user.id, formData.getAll("clanIds").map(String));
  if (!body) throw new Error("Report body required");

  const { error } = await supabase
    .from("scouting_reports")
    .update({ body, visibility })
    .eq("id", reportId)
    .eq("user_id", user.id);
  if (error) throw error;

  // Simplest correct approach for edits: replace the share list wholesale
  // rather than diffing it.
  const { error: clearSharesError } = await supabase
    .from("report_clan_shares")
    .delete()
    .eq("report_id", reportId);
  if (clearSharesError) throw clearSharesError;

  if (visibility === "SPECIFIC_CLANS" && clanIds.length > 0) {
    const { error: sharesError } = await supabase
      .from("report_clan_shares")
      .insert(clanIds.map((clanId) => ({ report_id: reportId, clan_id: clanId })));
    if (sharesError) throw sharesError;
  }

  revalidatePath(`/fights/${fightId}`);
}

export async function deleteReport(reportId: string, fightId: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("scouting_reports")
    .delete()
    .eq("id", reportId)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath(`/fights/${fightId}`);
}

export async function createFighterReport(formData: FormData) {
  const { supabase, user } = await requireUser();

  const fighterId = String(formData.get("fighterId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "PRIVATE") as ReportVisibility;
  const clanIds = await keepOnlyOwnClans(supabase, user.id, formData.getAll("clanIds").map(String));
  // Revalidate whichever page the form was submitted from (fight page or
  // fighter profile) so the new report shows up without a manual refresh.
  const redirectPath = String(formData.get("redirectPath") ?? `/fighters/${fighterId}`);

  if (!fighterId || !body) throw new Error("Missing fighter or report body");

  const { data: report, error } = await supabase
    .from("fighter_scouting_reports")
    .insert({ fighter_id: fighterId, user_id: user.id, body, visibility })
    .select("id")
    .single();
  if (error) throw error;

  if (visibility === "SPECIFIC_CLANS" && clanIds.length > 0) {
    const { error: sharesError } = await supabase
      .from("fighter_report_clan_shares")
      .insert(clanIds.map((clanId) => ({ fighter_report_id: report.id, clan_id: clanId })));
    if (sharesError) throw sharesError;
  }

  revalidatePath(redirectPath);
}

export async function updateFighterReport(reportId: string, redirectPath: string, formData: FormData) {
  const { supabase, user } = await requireUser();

  const body = String(formData.get("body") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "PRIVATE") as ReportVisibility;
  const clanIds = await keepOnlyOwnClans(supabase, user.id, formData.getAll("clanIds").map(String));
  if (!body) throw new Error("Report body required");

  const { error } = await supabase
    .from("fighter_scouting_reports")
    .update({ body, visibility })
    .eq("id", reportId)
    .eq("user_id", user.id);
  if (error) throw error;

  const { error: clearSharesError } = await supabase
    .from("fighter_report_clan_shares")
    .delete()
    .eq("fighter_report_id", reportId);
  if (clearSharesError) throw clearSharesError;

  if (visibility === "SPECIFIC_CLANS" && clanIds.length > 0) {
    const { error: sharesError } = await supabase
      .from("fighter_report_clan_shares")
      .insert(clanIds.map((clanId) => ({ fighter_report_id: reportId, clan_id: clanId })));
    if (sharesError) throw sharesError;
  }

  revalidatePath(redirectPath);
}

export async function deleteFighterReport(reportId: string, redirectPath: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("fighter_scouting_reports")
    .delete()
    .eq("id", reportId)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath(redirectPath);
}

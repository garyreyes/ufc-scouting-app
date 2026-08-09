"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ReportVisibility } from "./types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

export async function createReport(formData: FormData) {
  const { supabase, user } = await requireUser();

  const fightId = String(formData.get("fightId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "PRIVATE") as ReportVisibility;
  const clanIds = formData.getAll("clanIds").map(String);

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

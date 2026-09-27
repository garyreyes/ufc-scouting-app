"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/auth";
import { checkLegOverride } from "./checkLegOverride";

// INTERN slips are service-role-only (0064's RLS scopes every client write
// to author='USER'), so this runs through the admin client -- which makes
// the owner check below the real security boundary, same pattern as
// features/conflicts/actions.ts. Nothing about the leg is trusted from
// the caller: every fact checkLegOverride needs is re-read here.
async function requireOwner(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isOwner(user?.id)) throw new Error("Not authorized");
}

interface LegWithSlip {
  id: string;
  slip_id: string;
  price_source: string;
  leg_result: string;
  slip: { author: "USER" | "INTERN"; status: string; event: { starts_at: string | null } | null };
}

export async function setInternLegPriceAction(legId: string, price: number): Promise<{ error: string | null }> {
  await requireOwner();
  const admin = getSupabaseAdmin();

  const { data, error } = await admin
    .from("bet_legs")
    .select("id, slip_id, price_source, leg_result, slip:slip_id(author, status, event:event_id(starts_at))")
    .eq("id", legId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { error: "Leg not found." };
  const leg = data as unknown as LegWithSlip;

  const refusal = checkLegOverride({
    slipAuthor: leg.slip.author,
    slipStatus: leg.slip.status,
    priceSource: leg.price_source,
    legResult: leg.leg_result,
    startsAt: leg.slip.event?.starts_at ?? null,
    price,
    now: new Date(),
  });
  if (refusal) return { error: refusal };

  const rounded = Math.round(price * 1000) / 1000;
  const { error: legError } = await admin
    .from("bet_legs")
    .update({ price: rounded, price_source: "entered" })
    .eq("id", legId);
  if (legError) throw legError;

  // combined_price is display-only (settlement multiplies leg prices), but
  // it must still agree with the legs it summarises.
  const { data: legs, error: legsError } = await admin.from("bet_legs").select("price").eq("slip_id", leg.slip_id);
  if (legsError) throw legsError;
  const combined = (legs ?? []).reduce((p, l) => p * Number(l.price), 1);
  const { error: slipError } = await admin
    .from("bet_slips")
    .update({ combined_price: Math.round(combined * 1000) / 1000 })
    .eq("id", leg.slip_id);
  if (slipError) throw slipError;

  revalidatePath("/intern-slips");
  return { error: null };
}

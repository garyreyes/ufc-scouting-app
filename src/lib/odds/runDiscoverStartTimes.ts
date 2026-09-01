import { getSupabaseAdmin } from "../supabase/admin";
import { discoverStartTimes } from "./discoverStartTimes";

async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await discoverStartTimes(supabase);
  console.log(
    `Start-time discovery: ${summary.updated} events updated, ${summary.noConfidentMatch} with no confident match yet.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

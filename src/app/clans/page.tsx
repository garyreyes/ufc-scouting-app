import { createClient } from "@/lib/supabase/server";
import { getMyClans } from "@/features/clans/api";
import { CreateClanForm } from "@/features/clans/components/CreateClanForm";
import { ClanList } from "@/features/clans/components/ClanList";

export default async function ClansPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div>
        <h1>Clans</h1>
        <p>Sign in to see and create clans.</p>
      </div>
    );
  }

  const clans = await getMyClans();

  return (
    <div>
      <h1>Clans</h1>
      <CreateClanForm />
      <ClanList clans={clans} />
    </div>
  );
}

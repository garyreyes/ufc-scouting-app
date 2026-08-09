import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getInviteClanName } from "@/features/clans/api";
import { acceptInvite } from "@/features/clans/actions";
import { AuthButton } from "@/features/auth/components/AuthButton";
import styles from "./page.module.css";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const clanName = await getInviteClanName(token);
  if (!clanName) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div>
        <h1>Join {clanName}</h1>
        <p>Sign in to accept this invite.</p>
        <AuthButton />
      </div>
    );
  }

  return (
    <div>
      <h1>Join {clanName}</h1>
      <form action={acceptInvite.bind(null, token)}>
        <button type="submit" className={styles.button}>
          Join clan
        </button>
      </form>
    </div>
  );
}

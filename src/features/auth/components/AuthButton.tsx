"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useDismissableOpen } from "@/shared/utils/useDismissableOpen";
import { signInWithOAuth, signOut } from "../api";
import styles from "./AuthButton.module.css";

function displayName(user: User): string {
  const metadata = user.user_metadata as Record<string, unknown>;
  if (typeof metadata.full_name === "string") return metadata.full_name;
  return user.email ?? "Account";
}

function avatarUrl(user: User): string | null {
  const metadata = user.user_metadata as Record<string, unknown>;
  return typeof metadata.avatar_url === "string" ? metadata.avatar_url : null;
}

export function AuthButton() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useDismissableOpen(open, () => setOpen(false), containerRef, triggerRef);

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-label={user ? "Account menu" : "Sign in"}
        aria-expanded={open}
      >
        {user ? (
          avatarUrl(user) ? (
            // eslint-disable-next-line @next/next/no-img-element -- external OAuth avatar, not worth configuring remote patterns for
            <img src={avatarUrl(user)!} alt="" className={styles.avatarImg} />
          ) : (
            <span className={styles.avatarFallback}>{displayName(user).charAt(0).toUpperCase()}</span>
          )
        ) : (
          "Sign in"
        )}
      </button>
      {open && (
        <div className={styles.panel}>
          {user ? (
            <>
              <div className={styles.userInfo}>{displayName(user)}</div>
              <button
                type="button"
                className={styles.option}
                onClick={async () => {
                  await signOut();
                  setOpen(false);
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.option}
                onClick={() => signInWithOAuth("google", pathname)}
              >
                Continue with Google
              </button>
              <button
                type="button"
                className={styles.option}
                onClick={() => signInWithOAuth("github", pathname)}
              >
                Continue with GitHub
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

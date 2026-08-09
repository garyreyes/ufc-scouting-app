import { createClan } from "../actions";
import styles from "./CreateClanForm.module.css";

export function CreateClanForm() {
  return (
    <form action={createClan} className={styles.form}>
      <input type="text" name="name" placeholder="Clan name" required className={styles.input} />
      <button type="submit" className={styles.button}>
        Create clan
      </button>
    </form>
  );
}

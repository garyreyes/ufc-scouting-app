export interface JobRunRow {
  jobName: string;
  status: "success" | "failure";
  finishedAt: string;
  error: string | null;
}

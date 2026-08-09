-- Client-side maxLength alone can be bypassed by calling the Supabase
-- API directly with the anon key + a valid session, so the actual limit
-- has to live in the database. Not a security fix (React already
-- escapes rendered text -- see security review) -- this is abuse/cost
-- hygiene: nothing stops an unbounded paste today.

alter table scouting_reports
  add constraint scouting_reports_body_length check (char_length(body) <= 2000);

alter table fighter_scouting_reports
  add constraint fighter_scouting_reports_body_length check (char_length(body) <= 2000);

alter table clans
  add constraint clans_name_length check (char_length(name) <= 60);

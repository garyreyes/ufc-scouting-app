export interface Clan {
  id: string;
  name: string;
  created_by: string;
}

export interface ClanMember {
  user_id: string;
  display_name: string | null;
  joined_at: string;
}

export interface ClanInvite {
  id: string;
  token: string;
  created_at: string;
  revoked: boolean;
}

export interface ClanWithDetail extends Clan {
  members: ClanMember[];
  invites: ClanInvite[];
  isOwner: boolean;
}

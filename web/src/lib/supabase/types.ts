export type UserRole = 'player' | 'organizer' | 'club' | 'admin';

// ids בסכמה הקיימת הם TEXT (לא uuid)
export type Profile = {
  id: string; // auth.users.id — uuid
  email: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  club_id: string | null;
  organizer_id: string | null;
  player_id: string | null;
  avatar_url?: string | null;
  created_at: string;
};

export type Tournament = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  club_id: string | null;
  organizer_id: string | null;
  description: string | null;
  date: string | null;
  location: string | null;
  format: Record<string, any>;
  pricing: Record<string, any>;
  status: string;
  visibility: string;
  created_at: string;
};

export type Registration = {
  id: string;
  tournament_id: string;
  status: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  partner_name: string | null;
  partner_phone: string | null;
  notes: string | null;
  created_at: string;
};

export type Club = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  description: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: string;
};

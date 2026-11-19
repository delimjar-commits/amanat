/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

export interface PublicUser {
  id: string;
  display_name: string;
  avatar_url: string | null;
  area: string | null;
  bio: string | null;
  kyc_level: 'none' | 'basic' | 'verified' | 'business';
  trust_score: number;
  deals_completed: number;
  shop_name: string | null;
  created_at: string;
  badges: string[];
}

export interface MeUser extends PublicUser {
  email: string;
  phone: string | null;
  locale: string;
  referral_code: string;
  is_admin: boolean;
  admin_role: string | null;
  delete_requested_at: string | null;
}

export interface Me {
  user: MeUser;
  kyc: Row | null;
  unread_notifications: number;
  deal_limit_paisa: number;
}

export interface AppConfig {
  app_name: string;
  categories: string[];
  sandbox: boolean;
  fees: { platform_fee_percent: number; guarantee_fund_percent: number };
  limits: { basic: number; verified: number; business: number; new_user: number };
  auto_release_hours: number;
  help: Row;
}

export interface Listing extends Row {
  id: string;
  title: string;
  description: string;
  category: string;
  price_paisa: number;
  deal_type: string;
  condition: string | null;
  location_area: string | null;
  status: string;
  return_days: number;
  photos: { id: string; url: string | null }[];
  seller?: PublicUser;
  saved: boolean;
}

export interface Deal extends Row {
  id: string;
  title: string;
  status: string;
  amount_paisa: number;
  fee_paisa: number;
  guarantee_paisa: number;
  seller_net_paisa: number;
  handover: string;
  role: 'buyer' | 'seller';
  release_code: string | null;
  buyer: PublicUser;
  seller: PublicUser;
  events: Row[];
  proofs: Row[];
  dispute: Row | null;
  contract: Row | null;
  my_review: Row | null;
  payout: Row | null;
  trip: { url: string; expires_at: string } | null;
}

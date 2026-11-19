import { accent, role, tint } from './theme';

type S = { label: string; color: string; bg: string };
const mk = (label: string, color: string): S => ({ label, color, bg: tint(color, 0.13) });
const grey: S = { label: '', color: role.onSurfaceVariant, bg: role.surfaceContainerHigh };

// Plain words for every deal state the server uses.
export const dealStatus: Record<string, S> = {
  proposed: mk('Offer sent', accent.amber),
  accepted: mk('Accepted', accent.sky),
  payment_pending: mk('Waiting for payment', accent.amber),
  funded: mk('Money held safely', accent.green),
  handover_pending: mk('Money held safely', accent.green),
  shipped: mk('Shipped', accent.sky),
  buyer_confirmed: mk('Buyer confirmed', accent.green),
  release_queued: mk('Release being checked', accent.amber),
  released: mk('Released to seller', accent.green),
  paid_out: mk('Paid out', accent.green),
  completed: mk('Completed', accent.green),
  cancelled: { ...grey, label: 'Cancelled' },
  disputed: mk('In dispute', accent.red),
  refund_queued: mk('Refund being checked', accent.amber),
  refunded: mk('Refunded', accent.sky),
  split_queued: mk('Split being checked', accent.amber),
  split_done: mk('Split done', accent.sky),
};

export const kycLabel: Record<string, S> = {
  none: { ...grey, label: 'Not verified' },
  basic: mk('Phone verified', accent.sky),
  verified: mk('NID verified', accent.green),
  business: mk('Business', accent.pink),
};

export const actionLabel: Record<string, string> = {
  approve_kyc: 'Approve KYC',
  reject_kyc: 'Reject KYC',
  release_escrow: 'Release money',
  refund_escrow: 'Refund buyer',
  split_escrow: 'Split money',
  approve_payout: 'Pay seller',
  ban_user: 'Ban user',
  unban_user: 'Unban user',
  remove_listing: 'Remove listing',
  police_handover: 'Police data export',
  blacklist_add: 'Add to blacklist',
};

export const actionState: Record<string, S> = {
  pending: mk('Waiting', accent.amber),
  approved: mk('Approved', accent.sky),
  executed: mk('Done', accent.green),
  rejected: { ...grey, label: 'Rejected' },
  failed: mk('Failed', accent.red),
};

export const recColor = (rec?: string | null) =>
  !rec ? role.onSurfaceVariant : /reject|refund|ban|block|flag|escalate/.test(rec) ? accent.red : /approve|release/.test(rec) ? accent.green : accent.amber;

export const badgeLabel: Record<string, string> = {
  verified: 'NID verified',
  business: 'Business',
  ten_deals: '10+ deals',
  top_rated: 'Top rated',
  vouched: 'Vouched',
};

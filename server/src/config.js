// All configuration comes from environment variables. Business values (fees, limits)
// can be changed later in the admin app; these are only the starting defaults.
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  appName: process.env.APP_NAME || 'Amanat',
  port: num(process.env.PORT, 8080),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres@localhost:5544/p2pt?host=/tmp',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  fileSecret: process.env.FILE_SECRET || process.env.JWT_SECRET || 'dev-only-file-secret',
  releaseCodeSecret: process.env.RELEASE_CODE_SECRET || process.env.JWT_SECRET || 'dev-only-release-secret',
  nidPepper: process.env.NID_PEPPER || 'dev-only-nid-pepper',
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  paymentProvider: process.env.PAYMENT_PROVIDER || 'sandbox',
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || 'dev-only-webhook-secret',
  courierProvider: process.env.COURIER_PROVIDER || 'sandbox',
  courierWebhookSecret: process.env.COURIER_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || 'dev-only-courier-secret',
  sandbox: process.env.SANDBOX_MODE !== '0',
  jobs: process.env.JOBS !== '0',
  defaults: {
    platform_fee_percent: num(process.env.PLATFORM_FEE_PERCENT, 2),
    guarantee_fund_percent: num(process.env.GUARANTEE_FUND_PERCENT, 0.5),
    auto_release_hours: num(process.env.AUTO_RELEASE_HOURS, 72),
    dispute_evidence_hours: num(process.env.DISPUTE_EVIDENCE_HOURS, 48),
    release_code_max_attempts: num(process.env.RELEASE_CODE_MAX_ATTEMPTS, 5),
    trip_share_link_hours: num(process.env.TRIP_SHARE_LINK_HOURS, 6),
    limit_level1: num(process.env.LIMIT_LEVEL1, 5000),
    limit_level2: num(process.env.LIMIT_LEVEL2, 100000),
    limit_level3: num(process.env.LIMIT_LEVEL3, 500000),
    new_user_deal_limit: num(process.env.NEW_USER_DEAL_LIMIT, 3000),
    dispute_agent_refund_limit: num(process.env.DISPUTE_AGENT_REFUND_LIMIT, 20000),
    bulk_approve_min_confidence: num(process.env.BULK_APPROVE_MIN_CONFIDENCE, 0.95),
    bulk_approve_max_risk: num(process.env.BULK_APPROVE_MAX_RISK, 20),
    face_match_threshold: num(process.env.FACE_MATCH_THRESHOLD, 0.8),
    courier_sandbox_deliver_minutes: num(process.env.COURIER_SANDBOX_DELIVER_MINUTES, 120),
    categories: ['Phones & tablets', 'Electronics', 'Fashion', 'Home & living', 'Vehicles', 'Books & hobbies', 'Services', 'Rentals', 'Other'],
    banned_words: ['otp', 'pin number', 'advance payment', 'send money first', 'bkash number dao', 'pay outside'],
  },
};

export const isTest = process.env.NODE_ENV === 'test';

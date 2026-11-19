// AI agents. Every agent: rules first (always run, deterministic), then the language model
// refines when it is configured. Output is validated, saved to ai_reviews, and only ever
// becomes a recommendation inside admin_actions. No agent can move money or change accounts.
import { chat, chatJson, llmConfig } from './llm.js';
import { allSettings } from './settings.js';

export async function saveReview(c, r) {
  const row = await c.one(
    `insert into ai_reviews(agent, subject_type, subject_id, recommendation, confidence, risk_score, summary, evidence, model)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [r.agent, r.subject_type, r.subject_id, r.recommendation, clamp01(r.confidence), r.risk_score ?? null, r.summary, JSON.stringify(r.evidence || {}), r.model || 'rules'],
  );
  return row;
}
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const round3 = (x) => Math.round(x * 1000) / 1000;

function distanceM(a, b) {
  const R = 6371000, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export { distanceM };

async function fileDataUrl(c, id) {
  if (!id) return null;
  const f = await c.one('select mime, data from files where id = $1', [id]);
  return f ? `data:${f.mime};base64,${f.data.toString('base64')}` : null;
}

// ---------------- kyc_verifier ----------------
export async function kycVerifier(c, sub, user) {
  const s = await allSettings();
  const checks = [];
  let risk = 10;
  const add = (name, pass, detail) => { checks.push({ name, pass, detail }); if (!pass) risk += 20; };

  const digits = String(sub._nid_plain || '').replace(/\D/g, '');
  add('NID number format', [10, 13, 17].includes(digits.length), `${digits.length} digits (10, 13 or 17 expected)`);
  const dup = await c.one(
    `select user_id from kyc_submissions where nid_number_hash = $1 and user_id <> $2 and status in ('approved','pending','ai_checked') limit 1`,
    [sub.nid_number_hash, sub.user_id],
  );
  add('NID not used by another account', !dup, dup ? 'This NID is on another account' : 'unique');
  const bl = await c.one('select reason from blacklist where nid_number_hash = $1 limit 1', [sub.nid_number_hash]);
  add('NID not blacklisted', !bl, bl ? `Blacklisted: ${bl.reason}` : 'clear');
  add('Liveness steps done', !!sub.liveness_passed, sub.liveness_passed ? 'Looked straight and turned head, both live camera shots' : 'Liveness not completed');
  let ageOk = true;
  if (sub.date_of_birth) {
    const age = (Date.now() - new Date(sub.date_of_birth).getTime()) / (365.25 * 864e5);
    ageOk = age >= 18;
    add('Age 18 or over', ageOk, `${Math.floor(age)} years`);
  }

  let faceScore = null, ocr = null, model = 'rules', visionNote = 'No vision model set: admin compares the selfie and NID photo by eye.';
  const cfg = await llmConfig();
  if (cfg.enabled && cfg.vision) {
    try {
      const front = await fileDataUrl(c, sub.nid_front_path);
      const selfie = await fileDataUrl(c, sub.selfie_path);
      const { obj, model: m } = await chatJson(
        [
          { role: 'system', content: 'You check Bangladeshi NID cards for a KYC team. Reply with JSON only.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Image 1 is the front of an NID card. Image 2 is a live selfie. Return JSON: {"name_en":string|null,"name_bn":string|null,"dob":"YYYY-MM-DD"|null,"nid_number":string|null,"same_person_score":number 0..1,"document_looks_genuine":boolean,"notes":string}' },
              { type: 'image_url', image_url: { url: front } },
              { type: 'image_url', image_url: { url: selfie } },
            ],
          },
        ],
        (o) => typeof o.same_person_score === 'number',
        { tier: 'vision', timeoutMs: 60000 },
      );
      model = m;
      faceScore = round3(clamp01(obj.same_person_score));
      ocr = obj;
      visionNote = obj.notes || '';
      add('Face matches NID photo', faceScore >= s.face_match_threshold, `score ${faceScore} (threshold ${s.face_match_threshold})`);
      if (obj.nid_number) add('NID number on card matches what was typed', String(obj.nid_number).replace(/\D/g, '') === digits, `card: ****${String(obj.nid_number).slice(-4)}`);
      if (obj.name_en && sub.full_name_en) add('Name on card matches', normName(obj.name_en) === normName(sub.full_name_en), `card: ${obj.name_en}`);
      add('Document looks genuine', obj.document_looks_genuine !== false, obj.document_looks_genuine === false ? 'Possible edit or photo of a screen' : 'ok');
    } catch (e) {
      visionNote = `Vision check failed (${String(e.message).slice(0, 80)}). Manual review.`;
    }
  }

  const failed = checks.filter((x) => !x.pass);
  const hard = failed.some((x) => /another account|blacklisted|Age/.test(x.name));
  let recommendation = failed.length === 0 ? 'approve' : hard ? 'reject' : 'flag';
  let confidence = failed.length === 0 ? (faceScore !== null ? 0.96 : 0.75) : hard ? 0.95 : 0.6;
  risk = Math.min(100, hard ? Math.max(risk, 90) : risk);
  const summary =
    failed.length === 0
      ? `All ${checks.length} checks passed.${faceScore !== null ? ` Face match ${faceScore}.` : ' Face match needs your eyes: no vision model is set.'}`
      : `${failed.length} of ${checks.length} checks failed: ${failed.map((x) => x.name).join('; ')}.`;
  return {
    review: await saveReview(c, {
      agent: 'kyc_verifier', subject_type: 'kyc', subject_id: sub.id, recommendation, confidence, risk_score: risk,
      summary, evidence: { checks, vision_note: visionNote, duplicate_user_id: dup?.user_id || null }, model,
    }),
    faceScore, ocr, duplicateUserId: dup?.user_id || null, blacklisted: !!bl,
  };
}
export const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z\u0980-\u09ff]+/g, ' ').replace(/\b(md|mohammad|mohammed|muhammad)\b/g, 'md').trim().split(' ').filter(Boolean).sort().join(' ');

// ---------------- deal_verifier ----------------
export async function dealVerifier(c, deal) {
  const proofs = await c.many('select * from deal_proofs where deal_id = $1 order by captured_at', [deal.id]);
  const checks = [];
  let risk = 5;
  const add = (name, pass, detail) => { checks.push({ name, pass, detail }); if (!pass) risk += 25; };
  const byStage = (uid, st) => proofs.filter((p) => p.user_id === uid && p.stage === st);
  const mocks = proofs.filter((p) => p.is_mock_location);
  add('No fake GPS', mocks.length === 0, mocks.length ? `${mocks.length} proof(s) came from a mock location app` : 'all real locations');
  const webShots = proofs.filter((p) => p.source === 'web');
  if (webShots.length) checks.push({ name: 'Camera source', pass: true, detail: `${webShots.length} proof(s) taken in a browser, where camera-only can't be enforced`, warn: true });

  if (deal.handover === 'meetup' || deal.handover === 'pickup_point') {
    const b = byStage(deal.buyer_id, 'handover').at(-1), s = byStage(deal.seller_id, 'handover').at(-1);
    add('Both sides saved a handover selfie', !!(b && s), `${b ? 'buyer ✓' : 'buyer missing'}, ${s ? 'seller ✓' : 'seller missing'}`);
    if (b && s) {
      const dist = Math.round(distanceM(b, s));
      add('Both were in the same place', dist <= 300, `${dist} m apart`);
      const gapMin = Math.abs(new Date(b.captured_at) - new Date(s.captured_at)) / 60000;
      add('Selfies taken at the same time', gapMin <= 45, `${Math.round(gapMin)} min apart`);
    }
  } else if (deal.handover === 'courier') {
    add('Drop-off proof saved', byStage(deal.seller_id, 'dropoff').length > 0, 'seller drop-off photo');
    add('Tracking number added', !!deal.tracking_number, deal.tracking_number || 'none');
  }
  const codeUsed = await c.one(`select 1 from deal_events where deal_id = $1 and to_status = 'buyer_confirmed' and note ilike '%release code%'`, [deal.id]);
  checks.push({ name: 'How the buyer confirmed', pass: true, detail: codeUsed ? 'Seller entered the buyer\'s 4-digit release code' : 'Buyer tapped confirm in the app' });
  const failed = checks.filter((x) => !x.pass);
  const recommendation = failed.length ? 'flag' : 'release';
  const confidence = failed.length ? 0.55 : webShots.length ? 0.9 : 0.97;
  return saveReview(c, {
    agent: 'deal_verifier', subject_type: 'deal', subject_id: deal.id, recommendation, confidence, risk_score: Math.min(100, risk),
    summary: failed.length ? `Check before releasing: ${failed.map((x) => x.name.toLowerCase()).join('; ')}.` : 'Proofs line up: release looks safe.',
    evidence: { checks, proof_ids: proofs.map((p) => p.id) }, model: 'rules',
  });
}

// ---------------- dispute_analyst ----------------
export async function disputeAnalyst(c, dispute, deal) {
  const events = await c.many('select from_status, to_status, actor_kind, note, created_at from deal_events where deal_id = $1 order by id', [deal.id]);
  const proofs = await c.many('select user_id, stage, lat, lng, is_mock_location, captured_at from deal_proofs where deal_id = $1', [deal.id]);
  const evidence = await c.many('select user_id, note, array_length(media_paths,1) as files, created_at from dispute_evidence where dispute_id = $1 order by created_at', [dispute.id]);
  const msgs = await c.many(`select sender_id, kind, body, ai_flag, created_at from messages where chat_id = $1 order by created_at desc limit 60`, [deal.chat_id]);
  const who = (id) => (id === deal.buyer_id ? 'buyer' : id === deal.seller_id ? 'seller' : 'system');
  const opener = who(dispute.opened_by);
  const facts = [];
  let lean = 'split', conf = 0.5;
  const sellerProof = proofs.some((p) => p.user_id === deal.seller_id && ['handover', 'dropoff'].includes(p.stage));
  const buyerProof = proofs.some((p) => p.user_id === deal.buyer_id && p.stage === 'handover');
  if (deal.handover === 'courier') {
    if (deal.delivered_at) { facts.push('Courier marked the parcel delivered'); lean = opener === 'buyer' ? 'split' : 'release'; conf = 0.6; }
    else if (!deal.tracking_number || !sellerProof) { facts.push('No tracking number or drop-off proof from the seller'); lean = 'refund'; conf = 0.72; }
    else { facts.push('Parcel shipped but not delivered yet'); lean = 'refund'; conf = 0.55; }
  } else {
    if (!sellerProof) { facts.push('Seller never saved a handover proof'); lean = 'refund'; conf = 0.7; }
    else if (sellerProof && buyerProof) { facts.push('Both sides saved handover proofs at the meetup'); lean = opener === 'buyer' ? 'split' : 'release'; conf = 0.55; }
  }
  const ev = { buyer: evidence.filter((e) => e.user_id === deal.buyer_id).length, seller: evidence.filter((e) => e.user_id === deal.seller_id).length };
  facts.push(`Evidence: buyer ${ev.buyer}, seller ${ev.seller}`);
  const flagged = msgs.filter((m) => m.ai_flag);
  if (flagged.length) facts.push(`${flagged.length} chat message(s) were flagged by scam watch`);

  let rec = lean, summary = `Rules lean ${lean}: ${facts.join('; ')}.`, model = 'rules', keyPoints = facts, buyerPaisa = null;
  if (rec === 'split') buyerPaisa = Math.round(deal.amount_paisa / 2);
  const cfg = await llmConfig();
  if (cfg.enabled) {
    try {
      const transcript = msgs.reverse().map((m) => `[${who(m.sender_id)}] ${m.kind === 'text' ? m.body : `(${m.kind})`}${m.ai_flag ? ' {flagged}' : ''}`).join('\n').slice(0, 6000);
      const { obj, model: m } = await chatJson(
        [
          { role: 'system', content: 'You analyse disputes on an escrow marketplace for a human admin. You only recommend; the admin decides. Be neutral and cite facts. Reply with JSON only.' },
          {
            role: 'user',
            content: `Deal: ${deal.title}. Amount ${deal.amount_paisa / 100} BDT. Handover: ${deal.handover}. Terms: ${deal.terms}\nOpened by: ${opener}. Reason: ${dispute.reason}. Details: ${dispute.details || '-'}\nTimeline: ${events.map((e) => `${e.from_status || ''}->${e.to_status} by ${e.actor_kind}${e.note ? ` (${e.note})` : ''}`).join('; ')}\nProofs: ${JSON.stringify(proofs.map((p) => ({ by: who(p.user_id), stage: p.stage, mock: p.is_mock_location, at: p.captured_at })))}\nEvidence notes: ${JSON.stringify(evidence.map((e) => ({ by: who(e.user_id), note: e.note, files: e.files })))}\nCourier: tracking ${deal.tracking_number || 'none'}, delivered ${deal.delivered_at || 'no'}\nChat:\n${transcript}\n\nReturn JSON {"recommendation":"refund"|"release"|"split","buyer_share_percent":0-100 (only for split),"confidence":0..1,"summary":"2-3 plain sentences","key_points":["..."]}`,
          },
        ],
        (o) => ['refund', 'release', 'split'].includes(o.recommendation) && typeof o.confidence === 'number' && typeof o.summary === 'string',
        { tier: 'strong', timeoutMs: 60000 },
      );
      rec = obj.recommendation; conf = Math.min(0.9, clamp01(obj.confidence)); summary = obj.summary; model = m;
      keyPoints = [...(obj.key_points || []).slice(0, 6), ...facts];
      buyerPaisa = rec === 'split' ? Math.round((deal.amount_paisa * Math.max(0, Math.min(100, Number(obj.buyer_share_percent) || 50))) / 100) : null;
    } catch (e) {
      summary = `AI unavailable, manual review. ${summary}`;
      conf = 0;
    }
  }
  return saveReview(c, {
    agent: 'dispute_analyst', subject_type: 'dispute', subject_id: dispute.id, recommendation: rec, confidence: conf, risk_score: null,
    summary, evidence: { key_points: keyPoints, buyer_paisa: buyerPaisa, opener, evidence_counts: ev }, model,
  });
}

// ---------------- risk_scorer ----------------
export async function riskForUser(c, userId) {
  const u = await c.one('select * from profiles where id = $1', [userId]);
  if (!u) return { score: 100, reasons: ['unknown user'] };
  const reasons = [];
  let score = 10;
  const ageDays = (Date.now() - new Date(u.created_at)) / 864e5;
  if (ageDays < 3) { score += 15; reasons.push('account under 3 days old'); }
  if (u.kyc_level === 'none' || u.kyc_level === 'basic') { score += 10; reasons.push('no NID verification'); }
  const rep = await c.one(`select count(*)::int n from reports where target_user_id = $1 and status = 'open'`, [userId]);
  if (rep.n) { score += 10 * Math.min(rep.n, 4); reasons.push(`${rep.n} open report(s)`); }
  const lost = await c.one(`select count(*)::int n from disputes where loser_id = $1`, [userId]);
  if (lost.n) { score += 15 * Math.min(lost.n, 3); reasons.push(`lost ${lost.n} dispute(s)`); }
  const shared = await c.one(
    `select count(distinct d2.user_id)::int n from devices d1 join devices d2 on d2.device_fingerprint = d1.device_fingerprint and d2.user_id <> d1.user_id where d1.user_id = $1`,
    [userId],
  );
  if (shared.n) { score += 25; reasons.push('device shared with another account'); }
  if (u.trust_score < 30) { score += 10; reasons.push('low trust score'); }
  return { score: Math.min(100, score), reasons };
}
export async function riskForDeal(c, deal) {
  const b = await riskForUser(c, deal.buyer_id);
  const s = await riskForUser(c, deal.seller_id);
  let score = Math.max(b.score, s.score);
  const reasons = [...b.reasons.map((r) => `buyer: ${r}`), ...s.reasons.map((r) => `seller: ${r}`)];
  if (deal.amount_paisa >= 5000000) { score += 10; reasons.push('large amount'); }
  return { score: Math.min(100, score), reasons };
}

// ---------------- moderator (listings) ----------------
const PHONE_RE = /(?:\+?88)?0?1[3-9]\d{8}/;
export async function moderateListing(c, listing) {
  const s = await allSettings();
  const text = `${listing.title}\n${listing.description}`.toLowerCase();
  const issues = [];
  for (const w of s.banned_words || []) if (w && text.includes(String(w).toLowerCase())) issues.push(`banned phrase "${w}"`);
  if (PHONE_RE.test(text.replace(/[\s-]/g, ''))) issues.push('phone number in the listing (deals must stay in the app)');
  if (/whats\s?app|telegram|\bimo\b|bkash\s*number|nagad\s*number/.test(text)) issues.push('asks to contact or pay outside the app');
  if (/(iphone|samsung|pixel|macbook|laptop)/.test(text) && listing.price_paisa < 100000) issues.push('price looks too good to be true');
  let model = 'rules', summary = issues.length ? `Held for review: ${issues.join('; ')}.` : 'Looks fine.';
  const cfg = await llmConfig();
  if (!issues.length && cfg.enabled) {
    try {
      const { obj, model: m } = await chatJson(
        [
          { role: 'system', content: 'You moderate marketplace listings in Bangladesh. Flag scams, illegal items (drugs, weapons, fake documents, wildlife), adult content, and paying outside the platform. Reply JSON only.' },
          { role: 'user', content: `Title: ${listing.title}\nCategory: ${listing.category}\nPrice: ${listing.price_paisa / 100} BDT\nDescription: ${listing.description}\nReturn {"ok":boolean,"issues":[string]}` },
        ],
        (o) => typeof o.ok === 'boolean',
        { tier: 'fast', timeoutMs: 20000, maxTokens: 300 },
      );
      model = m;
      if (!obj.ok) { issues.push(...(obj.issues || ['flagged by AI'])); summary = `Held for review: ${issues.join('; ')}.`; }
    } catch {}
  }
  const review = await saveReview(c, {
    agent: 'moderator', subject_type: 'listing', subject_id: listing.id, recommendation: issues.length ? 'flag' : 'approve',
    confidence: issues.length ? 0.8 : 0.9, risk_score: issues.length ? 60 : 5, summary, evidence: { issues }, model,
  });
  return { ok: issues.length === 0, issues, review };
}

// ---------------- scam_watch (chat) ----------------
export function scamWatch(body, bannedWords = []) {
  const t = String(body || '').toLowerCase();
  const compact = t.replace(/[\s-]/g, '');
  if (/\botp\b|verification code|pin\s*(number|code)?\b.*(send|give|dao|den)|(send|give|dao|den).*\b(otp|pin)\b/.test(t)) return 'Never share an OTP or PIN. Nobody from the app will ask for it.';
  if (/(advance|agrim|অগ্রিম)/.test(t) || /(send|pay|dao|পাঠান|দিন).{0,25}(bkash|nagad|rocket|বিকাশ|নগদ)/.test(t) || /(bkash|nagad|rocket|বিকাশ|নগদ).{0,25}(send|pay|number|dao|kore|করে)/.test(t))
    return 'Pay only through the app. Money sent by bKash or Nagad directly is not protected.';
  if (/outside (the )?app|whats\s?app|telegram|\bimo\b|direct deal|বাইরে/.test(t)) return 'Keep the deal in the app. Deals outside it have no protection if something goes wrong.';
  if (PHONE_RE.test(compact)) return 'Sharing phone numbers moves the deal out of the app, where you lose protection.';
  if (/https?:\/\/|bit\.ly|wa\.me/.test(t)) return 'Be careful with links. Never enter your PIN or OTP on a link from chat.';
  for (const w of bannedWords) if (w && t.includes(String(w).toLowerCase())) return 'This message looks like a common scam pattern. Keep payment inside the app.';
  return null;
}

// ---------------- listing_assistant ----------------
export async function listingAssistant({ title, hints, category, condition }) {
  const cfg = await llmConfig();
  if (cfg.enabled) {
    try {
      const { obj } = await chatJson(
        [
          { role: 'system', content: 'You write clear, honest marketplace listings for Bangladesh. No phone numbers or outside-payment hints. Reply JSON only.' },
          { role: 'user', content: `Item: ${title}\nCategory: ${category || 'unknown'}\nCondition: ${condition || 'unknown'}\nSeller notes: ${hints || '-'}\nReturn {"title":string (max 70 chars),"description":string (4-7 short lines, plain),"category":string,"suggested_price_bdt":number|null,"price_note":string}` },
        ],
        (o) => typeof o.title === 'string' && typeof o.description === 'string',
        { tier: 'fast', timeoutMs: 30000, maxTokens: 500 },
      );
      return { ...obj, ai: true };
    } catch {}
  }
  const t = String(title || 'Item').trim();
  return {
    title: t.slice(0, 70),
    description: [`${t} for sale.`, condition ? `Condition: ${condition}.` : 'Condition: please ask.', hints ? String(hints).trim() : 'Works as it should.', 'Payment is held safely in the app until you get the item.', 'Meet at a safe spot or get it by courier.'].join('\n'),
    category: category || null,
    suggested_price_bdt: null,
    price_note: 'Set the AI key in the admin app for price suggestions.',
    ai: false,
  };
}

// ---------------- support_agent ----------------
export const HELP = [
  { id: 'escrow', q: 'How is my money kept safe?', a: 'When you pay, the money is held by the app, not sent to the seller. It is only released after you confirm you got the item (or share your 4-digit release code), and an admin approves the release.' },
  { id: 'kyc', q: 'Why do I need to verify my NID?', a: 'Everyone here is a real, verified person. Verifying your NID with a live selfie raises your deal limit and shows the Verified badge on your profile.' },
  { id: 'release-code', q: 'What is the release code?', a: 'After you pay, you get a 4-digit code. Only give it to the seller after you have checked the item in person. Entering it confirms the handover.' },
  { id: 'dispute', q: 'Something went wrong. What do I do?', a: 'Open the deal and tap Dispute before the money is released. Both sides add evidence, our AI prepares a summary, and an admin decides on a refund, a release or a split.' },
  { id: 'payout', q: 'When do I get paid as a seller?', a: 'After the deal is confirmed and the release is approved, the payout goes to your bKash, Nagad or bank account. The account name must match your verified NID name.' },
  { id: 'fees', q: 'What are the fees?', a: 'The seller pays a small platform fee and a guarantee-fund fee from the deal amount. You see the exact numbers on every deal before you accept.' },
  { id: 'safety', q: 'How do I meet safely?', a: 'Pick a safe spot from the list, share your trip with a friend, and use the SOS button if you feel unsafe. Both of you take a quick selfie at the handover.' },
  { id: 'outside', q: 'The other person wants to pay outside the app', a: 'Do not do it. Money sent outside the app is not protected and this is the most common scam. Report the chat if they insist.' },
];
export async function supportAgent(question, context) {
  const cfg = await llmConfig();
  if (cfg.enabled) {
    try {
      const r = await chat(
        [
          { role: 'system', content: `You are the friendly support helper for ${context.appName}, a P2P marketplace with escrow in Bangladesh. Answer in the user's language (Bangla or English), in 1-4 short sentences. Use only these facts:\n${HELP.map((h) => `- ${h.q} ${h.a}`).join('\n')}\nUser's deals: ${context.deals}\nYou cannot move money, change accounts or promise refunds. If they need a person, tell them to tap "Talk to a person".` },
          ...context.history.slice(-8),
          { role: 'user', content: question },
        ],
        { tier: 'fast', timeoutMs: 25000, maxTokens: 300 },
      );
      return r.text.trim();
    } catch {}
  }
  const t = question.toLowerCase();
  const scored = HELP.map((h) => ({ h, s: (h.q + ' ' + h.a).toLowerCase().split(/\W+/).filter((w) => w.length > 3 && t.includes(w)).length })).sort((a, b) => b.s - a.s);
  if (scored[0].s > 0) return scored[0].h.a;
  return 'I can help with payments, verification, release codes, disputes and payouts. For anything else, tap "Talk to a person" and our team will reply here.';
}

// ---------------- admin_copilot (read-only) ----------------
export async function adminCopilot(question, snapshot) {
  const cfg = await llmConfig();
  if (!cfg.enabled) {
    return `AI is off, so here are the live numbers: ${Object.entries(snapshot.stats).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ')}.`;
  }
  const r = await chat(
    [
      { role: 'system', content: 'You are a read-only assistant for marketplace admins. Answer only from the data given. You cannot take actions; suggest which queue item to open instead. Be short and specific, use names, amounts in BDT and dates.' },
      { role: 'user', content: `Data (JSON):\n${JSON.stringify(snapshot).slice(0, 14000)}\n\nQuestion: ${question}` },
    ],
    { tier: 'strong', timeoutMs: 45000, maxTokens: 700 },
  );
  return r.text.trim();
}

// ---------------- daily fraud report ----------------
export async function fraudReport(c) {
  const sharedDevices = await c.many(
    `select device_fingerprint, array_agg(p.email) emails, count(*)::int n from devices d join profiles p on p.id = d.user_id group by device_fingerprint having count(*) > 1 limit 20`,
  );
  const reported = await c.many(
    `select p.id, p.display_name, p.email, count(r.*)::int reports from reports r join profiles p on p.id = r.target_user_id where r.created_at > now() - interval '7 days' group by p.id having count(r.*) >= 2 order by 4 desc limit 20`,
  );
  const disputers = await c.many(
    `select p.id, p.display_name, count(*)::int disputes from disputes d join profiles p on p.id = d.opened_by where d.created_at > now() - interval '30 days' group by p.id having count(*) >= 2 order by 3 desc limit 20`,
  );
  const sharedPayout = await c.many(
    `select account_number, count(distinct user_id)::int users from payout_accounts group by account_number having count(distinct user_id) > 1 limit 20`,
  );
  const lockouts = await c.many(`select subject_id, title, created_at from alerts where kind = 'release_code_lockout' and created_at > now() - interval '24 hours'`);
  const flaggedMsgs = await c.one(`select count(*)::int n from messages where ai_flag is not null and created_at > now() - interval '24 hours'`);
  const data = { shared_devices: sharedDevices, reported_users: reported, repeat_disputers: disputers, shared_payout_accounts: sharedPayout, release_code_lockouts: lockouts, scam_flags_24h: flaggedMsgs.n };
  let summary = [
    `${sharedDevices.length} device(s) used by more than one account`,
    `${reported.length} user(s) reported twice or more this week`,
    `${disputers.length} user(s) opened 2+ disputes in 30 days`,
    `${sharedPayout.length} payout account(s) shared between users`,
    `${lockouts.length} release-code lockout(s) and ${flaggedMsgs.n} scam-flagged message(s) in 24 hours`,
  ].join('. ') + '.';
  let model = 'rules';
  const cfg = await llmConfig();
  if (cfg.enabled) {
    try {
      const r = await chat([{ role: 'system', content: 'Write a short fraud briefing for marketplace admins: the 3 most important things to look at today, then one line per pattern. Plain text, no markdown headings.' }, { role: 'user', content: JSON.stringify(data).slice(0, 10000) }], { tier: 'strong', timeoutMs: 45000, maxTokens: 600 });
      summary = r.text.trim(); model = r.model;
    } catch {}
  }
  return saveReview(c, { agent: 'fraud_report', subject_type: 'platform', subject_id: '00000000-0000-0000-0000-000000000000', recommendation: 'info', confidence: 1, risk_score: null, summary, evidence: data, model });
}

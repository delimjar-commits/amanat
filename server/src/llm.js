// OmniRoute (OpenAI-compatible) gateway. The admin pastes base URL, key and model names
// in the admin app. With nothing configured, agents run on their rule-based checks only.
import { allSettings, decrypt } from './settings.js';

export const lastCall = { ok: null, at: null, model: null, error: null, latencyMs: null };

export function normalizeBaseUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  if (!/\/v\d+$/.test(u)) u = `${u}/v1`;
  return u;
}

export async function llmConfig() {
  const s = (await allSettings()).ai || {};
  const key = (s.apiKeyEnc && decrypt(s.apiKeyEnc)) || process.env.OMNIROUTE_API_KEY || '';
  const baseUrl = normalizeBaseUrl(s.baseUrl || process.env.OMNIROUTE_BASE_URL || '');
  const enabled = s.enabled !== false && !!key && !!baseUrl && process.env.LLM_DISABLED !== '1';
  return {
    enabled,
    key,
    baseUrl,
    fast: s.modelFast || process.env.LLM_FAST_MODEL || 'auto',
    strong: s.modelStrong || process.env.LLM_STRONG_MODEL || s.modelFast || 'auto',
    vision: s.modelVision || process.env.LLM_VISION_MODEL || '',
  };
}

export async function chat(messages, { tier = 'fast', json = false, timeoutMs = 45000, maxTokens = 900 } = {}) {
  const cfg = await llmConfig();
  if (!cfg.enabled) throw new Error('AI not configured');
  const model = cfg[tier] || cfg.fast;
  if (!model) throw new Error(`No ${tier} model set`);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}`, 'ngrok-skip-browser-warning': '1' },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`AI gateway ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    const out = data.choices?.[0]?.message?.content ?? '';
    Object.assign(lastCall, { ok: true, at: new Date().toISOString(), model: data.model || model, error: null, latencyMs: Date.now() - started });
    return { text: typeof out === 'string' ? out : JSON.stringify(out), model: data.model || model };
  } catch (e) {
    Object.assign(lastCall, { ok: false, at: new Date().toISOString(), model, error: String(e.message || e).slice(0, 300), latencyMs: Date.now() - started });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson(text) {
  const s = String(text || '').trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// Ask for JSON, validate with `check`, retry once, else throw.
export async function chatJson(messages, check, opts = {}) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await chat(messages, { ...opts, json: true });
      const obj = parseJson(r.text);
      if (obj && check(obj)) return { obj, model: r.model };
      lastErr = new Error('AI output did not match the expected shape');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

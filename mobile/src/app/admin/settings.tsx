import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ListRow, Small, useAdmin } from '../../components/admin';
import { KV, Loader, Notice } from '../../components/bits';
import { Text } from '../../components/Text';
import { Button, Card, ErrorText, Field, Page, SectionTitle, SwitchRow } from '../../components/ui';
import { timeAgo, tk } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { accent, role, type } from '../../lib/theme';
import type { Row } from '../../lib/types';

// Number settings, with how to show and type them. Money is stored in paisa and typed in taka.
const NUMS: { k: string; label: string; money?: boolean; hint?: string }[] = [
  { k: 'platform_fee_percent', label: 'Platform fee (%)' },
  { k: 'guarantee_fund_percent', label: 'Guarantee fund (%)' },
  { k: 'auto_release_hours', label: 'Auto release after delivery (hours)' },
  { k: 'dispute_evidence_hours', label: 'Time to send dispute evidence (hours)' },
  { k: 'release_code_max_attempts', label: 'Wrong release-code tries before lock' },
  { k: 'trip_share_link_hours', label: 'Trip link lasts (hours)' },
  { k: 'new_user_deal_limit', label: 'Limit, phone not confirmed (taka)', money: true },
  { k: 'limit_level1', label: 'Limit, phone confirmed (taka)', money: true },
  { k: 'limit_level2', label: 'Limit, NID verified (taka)', money: true },
  { k: 'limit_level3', label: 'Limit, business (taka)', money: true },
  { k: 'dispute_agent_refund_limit', label: 'Most a dispute agent can refund (taka)', money: true },
  { k: 'bulk_approve_min_confidence', label: 'Bulk approve: lowest AI confidence (0 to 1)' },
  { k: 'bulk_approve_max_risk', label: 'Bulk approve: highest risk (0 to 100)' },
  { k: 'face_match_threshold', label: 'Face match needed (0 to 1)' },
];

function Num({ label, value, onChange, editable }: { label: string; value: string; onChange: (v: string) => void; editable: boolean }) {
  return <Field label={label} value={value} onChangeText={(t) => onChange(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" editable={editable} />;
}

export default function AdminSettings() {
  const { api, isSuper } = useAdmin();
  const { data, error, loading, reload } = useLoad(() => api.get<Row>('/api/admin/settings'));
  const spots = useLoad(() => api.get<{ spots: Row[] }>('/api/admin/safe-spots'));
  const jobs = useLoad(() => api.get<{ jobs: Row[] }>('/api/admin/jobs'));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [cats, setCats] = useState('');
  const [words, setWords] = useState('');
  const [ai, setAi] = useState({ base_url: '', api_key: '', model_fast: '', model_strong: '', model_vision: '', enabled: true });
  const [spot, setSpot] = useState({ name: '', area: '', lat: '', lng: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();

  useEffect(() => {
    if (!data) return;
    const s = data.settings || {};
    const v: Record<string, string> = {};
    for (const n of NUMS) v[n.k] = s[n.k] == null ? '' : String(n.money ? Number(s[n.k]) / 100 : s[n.k]);
    setVals(v);
    setCats((s.categories || []).join(', '));
    setWords((s.banned_words || []).join(', '));
    setAi({ base_url: data.ai.base_url, api_key: '', model_fast: data.ai.model_fast, model_strong: data.ai.model_strong, model_vision: data.ai.model_vision, enabled: data.ai.enabled !== false });
  }, [data]);

  if (loading && !data) return <Loader />;
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  const saveRules = () =>
    act.run('rules', async () => {
      const body: Row = { categories: list(cats), banned_words: list(words) };
      for (const n of NUMS) if (vals[n.k] !== '') body[n.k] = n.money ? Math.round(Number(vals[n.k]) * 100) : Number(vals[n.k]);
      await api.put('/api/admin/settings', body);
      setMsg('Fees and limits saved.');
      reload();
    });
  const saveAi = () =>
    act.run('ai', async () => {
      const body: Row = { base_url: ai.base_url.trim(), model_fast: ai.model_fast.trim(), model_strong: ai.model_strong.trim(), model_vision: ai.model_vision.trim(), enabled: ai.enabled };
      if (ai.api_key.trim()) body.api_key = ai.api_key.trim();
      await api.put('/api/admin/settings/ai', body);
      setMsg('AI settings saved.');
      reload();
    });
  const testAi = () =>
    act.run('test', async () => {
      const r = await api.post<Row>('/api/admin/settings/ai/test');
      setMsg(r.ok ? `The AI answered using ${r.model}.` : `The AI didn't answer: ${r.error}`);
    });
  const addSpot = () =>
    act.run('spot', async () => {
      await api.post('/api/admin/safe-spots', { name: spot.name.trim(), area: spot.area.trim(), lat: Number(spot.lat), lng: Number(spot.lng) });
      setSpot({ name: '', area: '', lat: '', lng: '' });
      spots.reload();
    });

  return (
    <Page gap={14}>
      <ErrorText text={error || act.error} />
      {msg ? <Notice tone={msg.includes("didn't") ? 'bad' : 'ok'} text={msg} /> : null}
      {!isSuper ? <Notice text="Only a super admin can change settings. You can view them." /> : null}

      <Card style={{ gap: 2 }}>
        <SectionTitle title="AI (OmniRoute)" />
        <Small>Paste your OmniRoute address and key. The key is stored encrypted and never shown again.</Small>
        <View style={{ height: 8 }} />
        <SwitchRow icon="sparkles" color={accent.pink} title="AI on" sub="Recommendations, chat scam checks and the helper" value={ai.enabled} onValueChange={(v) => isSuper && setAi({ ...ai, enabled: v })} />
        <Field label="OmniRoute address (base URL)" value={ai.base_url} onChangeText={(t) => setAi({ ...ai, base_url: t })} autoCapitalize="none" keyboardType="url" editable={isSuper} />
        <Field label={data?.ai?.has_key ? `API key (saved ${data.ai.key_hint}, type to replace)` : 'API key'} value={ai.api_key} onChangeText={(t) => setAi({ ...ai, api_key: t })} autoCapitalize="none" secureTextEntry editable={isSuper} />
        <Field label="Fast model" value={ai.model_fast} onChangeText={(t) => setAi({ ...ai, model_fast: t })} autoCapitalize="none" editable={isSuper} />
        <Field label="Strong model (disputes, ID checks)" value={ai.model_strong} onChangeText={(t) => setAi({ ...ai, model_strong: t })} autoCapitalize="none" editable={isSuper} />
        <Field label="Vision model (photos)" value={ai.model_vision} onChangeText={(t) => setAi({ ...ai, model_vision: t })} autoCapitalize="none" editable={isSuper} />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {isSuper ? <Button small title="Save AI" icon="check" onPress={saveAi} loading={act.busy === 'ai'} /> : null}
          <Button small variant="ghost" title="Test" icon="bolt" onPress={testAi} loading={act.busy === 'test'} />
        </View>
        <Small>
          Status: {data?.ai?.enabled ? 'on' : 'off'}
          {data?.ai?.last?.at ? ` · last call ${timeAgo(data.ai.last.at)} ${data.ai.last.ok ? 'worked' : `failed: ${data.ai.last.error || ''}`}` : ''}
        </Small>
      </Card>

      <Card style={{ gap: 2 }}>
        <SectionTitle title="Fees and limits" />
        {NUMS.map((n) => (
          <Num key={n.k} label={n.label} value={vals[n.k] ?? ''} onChange={(v) => setVals({ ...vals, [n.k]: v })} editable={isSuper} />
        ))}
        <Field label="Categories (comma separated)" value={cats} onChangeText={setCats} multiline editable={isSuper} />
        <Field label="Blocked words in listings (comma separated)" value={words} onChangeText={setWords} multiline editable={isSuper} />
        {isSuper ? <Button title="Save fees and limits" icon="check" onPress={saveRules} loading={act.busy === 'rules'} /> : null}
      </Card>

      <Card style={{ gap: 6 }}>
        <SectionTitle title="Safe meeting spots" count={spots.data?.spots.length} />
        {(spots.data?.spots || []).map((s) => (
          <ListRow
            key={s.id}
            icon="map-pin"
            color={accent.green}
            title={s.name}
            sub={`${s.area} · ${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}`}
            right={isSuper ? <Button small variant="ghost" title="Remove" onPress={() => act.run('del' + s.id, async () => { await api.del(`/api/admin/safe-spots/${s.id}`); spots.reload(); })} /> : undefined}
          />
        ))}
        <Field label="Name" value={spot.name} onChangeText={(t) => setSpot({ ...spot, name: t })} />
        <Field label="Area" value={spot.area} onChangeText={(t) => setSpot({ ...spot, area: t })} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Latitude" value={spot.lat} onChangeText={(t) => setSpot({ ...spot, lat: t })} keyboardType="numbers-and-punctuation" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Longitude" value={spot.lng} onChangeText={(t) => setSpot({ ...spot, lng: t })} keyboardType="numbers-and-punctuation" />
          </View>
        </View>
        <Button small title="Add spot" icon="plus" onPress={addSpot} loading={act.busy === 'spot'} disabled={!spot.name.trim() || !spot.area.trim() || !spot.lat || !spot.lng} />
      </Card>

      <Card>
        <SectionTitle title="Background jobs" />
        {(jobs.data?.jobs || []).map((j) => (
          <View key={j.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
            <View style={{ flex: 1 }}>
              <Text style={[type.titleSmall, { color: role.onSurface }]}>{j.name}</Text>
              <Small>
                Every {j.every_minutes} min{j.last_run ? ` · last ${timeAgo(j.last_run)}` : ''}
                {j.error ? ` · error: ${j.error}` : ''}
              </Small>
            </View>
            {isSuper ? <Button small variant="ghost" title="Run" onPress={() => act.run('job' + j.name, async () => { await api.post(`/api/admin/jobs/${j.name}/run`); jobs.reload(); })} loading={act.busy === 'job' + j.name} /> : null}
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle title="Server" />
        <KV k="Payments" v={`${data?.env?.payment_provider}${data?.env?.sandbox ? ' (test money only)' : ''}`} />
        <KV k="Courier" v={data?.env?.courier_provider} />
        <KV k="Admins set in ADMIN_EMAILS" v={String(data?.env?.admin_emails ?? 0)} />
        <KV k="Largest deal now" v={vals.limit_level3 ? tk(Number(vals.limit_level3) * 100) : '—'} />
      </Card>
    </Page>
  );
}

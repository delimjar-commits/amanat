import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { KV, Loader, Notice, Segmented, Stat } from '../components/bits';
import { Icon } from '../components/Icon';
import { Text } from '../components/Text';
import { Button, Card, ErrorText, Field, Page, SectionTitle, StatusPill } from '../components/ui';
import { dateTime, titleCase, tk } from '../lib/format';
import { useAction, useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { accent, role, type } from '../lib/theme';
import type { Row } from '../lib/types';

export default function Wallet() {
  const { api, me } = useSession();
  const w = useLoad(() => api.get<Row>('/api/wallet'), []);
  const accts = useLoad(() => api.get<{ accounts: Row[] }>('/api/payout-accounts'), []);
  const [method, setMethod] = useState<'bkash' | 'nagad' | 'bank'>('bkash');
  const [num, setNum] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  const verified = me?.user.kyc_level === 'verified' || me?.user.kyc_level === 'business';
  if (w.loading && !w.data) return <Loader />;
  const d = w.data || {};
  return (
    <Page gap={14} refreshControl={<RefreshControl refreshing={w.refreshing} onRefresh={w.refresh} />}>
      <ErrorText text={w.error} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Stat label="Held for your purchases" value={tk(d.held_as_buyer_paisa)} icon="lock-closed" color={accent.sky} />
        <Stat label="Waiting to be paid to you" value={tk(d.waiting_payout_paisa)} icon="clock" color={accent.amber} />
        <Stat label="Paid out to you" value={tk(d.paid_out_paisa)} icon="banknotes" color={accent.green} />
      </View>

      <Card>
        <SectionTitle title="Where you get paid" />
        {accts.data?.accounts.length ? (
          accts.data.accounts.map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
              <Icon name={a.method === 'bank' ? 'building-library' : 'device-phone-mobile'} size={22} color={role.onSurface} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type.bodyLarge}>
                  {a.method === 'bkash' ? 'bKash' : a.method === 'nagad' ? 'Nagad' : 'Bank'} {a.account_number}
                </Text>
                <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>{a.account_name}</Text>
              </View>
              <StatusPill s={a.name_matches_kyc ? { label: 'Name matches NID', color: accent.green, bg: 'rgba(78,203,113,0.13)' } : { label: 'Blocked: name differs', color: accent.red, bg: 'rgba(255,90,95,0.13)' }} />
            </View>
          ))
        ) : (
          <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>No payout account yet.</Text>
        )}
        {verified ? (
          <View style={{ gap: 12, marginTop: 12 }}>
            <Segmented
              value={method}
              onChange={setMethod}
              options={[
                { value: 'bkash', label: 'bKash' },
                { value: 'nagad', label: 'Nagad' },
                { value: 'bank', label: 'Bank' },
              ]}
            />
            <Field label={method === 'bank' ? 'Account number' : 'Wallet number'} value={num} onChangeText={setNum} keyboardType={method === 'bank' ? 'number-pad' : 'phone-pad'} />
            <Field label="Name on the account" hint="Must match the name on your verified NID." value={name} onChangeText={setName} autoCapitalize="characters" />
            <ErrorText text={act.error} />
            {msg ? <Notice tone={msg.startsWith('Saved.') ? 'ok' : 'warn'} text={msg} /> : null}
            <Button
              title="Save payout account"
              loading={act.busy === 'save'}
              onPress={() =>
                act.run('save', async () => {
                  const r = await api.post<{ message: string }>('/api/payout-accounts', { method, account_number: num, account_name: name });
                  setMsg(r.message);
                  setNum('');
                  accts.reload();
                  w.reload();
                })
              }
            />
          </View>
        ) : (
          <Notice tone="warn" text="Verify your NID before adding a payout account. Payouts only go to an account in your own name." />
        )}
      </Card>

      <Card>
        <SectionTitle title="Payouts" />
        {(d.payouts || []).length ? (
          (d.payouts as Row[]).map((p) => <KV key={p.id} k={`${p.title || 'Deal'} · ${dateTime(p.created_at)}`} v={`${titleCase(p.status)} · ${tk(p.amount_paisa)}`} />)
        ) : (
          <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>No payouts yet.</Text>
        )}
        <Text style={[type.bodySmall, { color: role.onSurfaceVariant, marginTop: 8 }]}>Test mode: payouts are simulated. An Amanat team member approves each one.</Text>
      </Card>
    </Page>
  );
}

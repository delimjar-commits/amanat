import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ListRow, RiskCard, roleLabel, Small, useAdmin } from '../../../components/admin';
import { UserLine } from '../../../components/adminSubject';
import { KV, Loader, Notice } from '../../../components/bits';
import { Button, Card, Chip, ErrorText, Field, Page, SectionTitle, StatusPill } from '../../../components/ui';
import { dateTime, pct, titleCase, tk } from '../../../lib/format';
import { useAction, useLoad } from '../../../lib/hooks';
import { kycLabel } from '../../../lib/status';
import { accent } from '../../../lib/theme';
import type { Row } from '../../../lib/types';

const ROLES = ['none', 'super_admin', 'kyc_reviewer', 'dispute_agent', 'support', 'finance'];

export default function AdminUser() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, isSuper } = useAdmin();
  const { data, error, loading, reload } = useLoad(() => api.get<Row>(`/api/admin/users/${id}`), [id]);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  if (loading && !data) return <Loader />;
  if (!data) return <Page><ErrorText text={error || 'Not found'} /></Page>;
  const u = data.user;
  const currentRole = u.admin?.active ? u.admin.role : 'none';

  const request = (type: string) =>
    act.run(type, async () => {
      const r = await api.post<{ action: Row }>('/api/admin/actions', { type, subject_id: u.id, reason: reason.trim() });
      setMsg('Added to the approvals queue. It runs once it is approved there.');
      setReason('');
      if (r.action?.id) router.push(`/admin/action/${r.action.id}`);
    });
  const setRole = (r: string) =>
    act.run('role', async () => {
      await api.post(`/api/admin/users/${u.id}/role`, { role: r });
      setMsg(r === 'none' ? 'Staff access removed.' : `Now ${roleLabel[r]}.`);
      reload();
    });

  return (
    <Page gap={12}>
      <UserLine u={u} />
      <Card>
        <SectionTitle title="Account" />
        <KV k="Joined" v={dateTime(u.created_at)} />
        <KV k="Deals done" v={String(u.deals_completed ?? 0)} />
        <KV k="Status" v={u.is_banned ? 'Banned' : 'Active'} />
        {(data.payout_accounts || []).map((p: Row, i: number) => (
          <KV key={i} k={`Payout ${titleCase(p.method)} …${p.last4}`} v={`${p.account_name} ${p.name_matches_kyc ? '(matches NID)' : '(does not match NID)'}`} />
        ))}
      </Card>
      <RiskCard risk={data.risk} />
      {(data.devices || []).some((d: Row) => d.shared_with?.length) ? (
        <Notice tone="bad" text={`This phone is also used by: ${data.devices.flatMap((d: Row) => d.shared_with || []).join(', ')}`} />
      ) : null}
      {(data.kyc || []).length ? (
        <Card>
          <SectionTitle title="ID checks" />
          {data.kyc.map((k: Row) => (
            <View key={k.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, gap: 8 }}>
              <Small>
                {titleCase(k.level)} · {k.full_name_en || '—'} · face {pct(k.face_match_score)} · {dateTime(k.created_at)}
              </Small>
              <StatusPill status={k.status} map={kycLabel} />
            </View>
          ))}
        </Card>
      ) : null}
      {(data.deals || []).length ? (
        <View style={{ gap: 8 }}>
          <SectionTitle title="Deals" count={data.deals.length} />
          {data.deals.slice(0, 10).map((d: Row) => (
            <ListRow key={d.id} icon="shield-check" title={`${d.title} · ${tk(d.amount_paisa)}`} sub={`As ${d.role} · ${titleCase(d.status)}`} onPress={() => router.push(`/admin/deal/${d.id}`)} />
          ))}
        </View>
      ) : null}
      {(data.reports || []).length ? (
        <Card>
          <SectionTitle title="Reports about this user" />
          {data.reports.map((r: Row, i: number) => (
            <KV key={i} k={`${r.reporter || 'Someone'} · ${titleCase(r.status)}`} v={r.reason} />
          ))}
        </Card>
      ) : null}
      <Card style={{ gap: 4 }}>
        <SectionTitle title="Actions" />
        <Small>Each goes to the approvals queue first, so a second click is always needed.</Small>
        <Field label="Reason" value={reason} onChangeText={setReason} maxLength={500} />
        <ErrorText text={act.error} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {u.is_banned ? <Button small title="Unban" icon="check" onPress={() => request('unban_user')} loading={act.busy === 'unban_user'} disabled={!reason.trim()} /> : <Button small variant="danger" title="Ban" icon="no-symbol" onPress={() => request('ban_user')} loading={act.busy === 'ban_user'} disabled={!reason.trim()} />}
          <Button small variant="danger" title="Blacklist" icon="x-circle" onPress={() => request('blacklist_add')} loading={act.busy === 'blacklist_add'} disabled={!reason.trim()} />
          {isSuper ? <Button small variant="ghost" title="Police export" icon="document-text" onPress={() => request('police_handover')} loading={act.busy === 'police_handover'} disabled={!reason.trim()} /> : null}
        </View>
      </Card>
      {isSuper ? (
        <Card>
          <SectionTitle title="Staff role" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ROLES.map((r) => (
              <Chip key={r} label={r === 'none' ? 'Not staff' : roleLabel[r]} selected={currentRole === r} onPress={() => (currentRole === r ? undefined : setRole(r))} />
            ))}
          </View>
        </Card>
      ) : null}
      {msg ? <Notice tone="ok" text={msg} /> : null}
      {u.is_banned ? null : <Small color={accent.green}>{''}</Small>}
    </Page>
  );
}

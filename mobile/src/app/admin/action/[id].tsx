import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useSession } from '../../../lib/session';
import { AiReviewCard, RiskCard, Small, useAdmin } from '../../../components/admin';
import { SubjectView } from '../../../components/adminSubject';
import { KV, Loader, Notice } from '../../../components/bits';
import { Text } from '../../../components/Text';
import { Button, Card, ErrorText, Field, Page, SectionTitle, StatusPill } from '../../../components/ui';
import { dateTime, titleCase, tk } from '../../../lib/format';
import { useAction, useLoad } from '../../../lib/hooks';
import { actionLabel, actionState } from '../../../lib/status';
import { role, type } from '../../../lib/theme';
import type { Row } from '../../../lib/types';

const approveWord: Record<string, string> = {
  approve_kyc: 'Approve ID',
  reject_kyc: 'Confirm rejection',
  release_escrow: 'Release to seller',
  refund_escrow: 'Refund buyer',
  split_escrow: 'Approve split',
  approve_payout: 'Send payout',
  remove_listing: 'Remove listing',
  ban_user: 'Ban user',
  unban_user: 'Unban user',
  blacklist_add: 'Add to blacklist',
  police_handover: 'Approve export',
};

export default function ActionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useAdmin();
  const { adminToken } = useSession();
  const { data, error, loading, reload } = useLoad(() => api.get<Row>(`/api/admin/actions/${id}`), [id]);
  const [note, setNote] = useState('');
  const [buyer, setBuyer] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();
  if (loading && !data) return <Loader />;
  if (!data) return <Page><ErrorText text={error || 'Not found'} /></Page>;
  const a = data.action;
  const pending = a.status === 'pending';
  const isSplit = a.type === 'split_escrow';
  const dealAmount = Number(data.subject?.deal?.amount_paisa || 0);

  const decide = (decision: 'approve' | 'reject') =>
    act.run(decision, async () => {
      const body: Row = { decision, note: note.trim() || undefined };
      if (decision === 'approve' && isSplit && buyer.trim()) body.payload_edit = { buyer_paisa: Math.round(Number(buyer) * 100) };
      const r = await api.post<Row>(`/api/admin/actions/${id}/decide`, body);
      setDone(r.status === 'executed' ? 'Done. It has been carried out.' : r.status === 'rejected' ? 'Rejected. The history keeps your reason.' : r.status === 'failed' ? `It was approved but failed to run: ${r.error || 'see the audit log'}.` : `Status: ${r.status}`);
      reload();
    });

  return (
    <Page gap={12}>
      <View style={{ gap: 6 }}>
        <Text style={[type.titleLarge, { color: role.onBackground }]}>{actionLabel[a.type] || titleCase(a.type)}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusPill status={a.status} map={actionState} />
          <Small>
            Asked by {String(a.requested_by || 'system').startsWith('admin:') ? 'an admin' : a.requested_by} · {dateTime(a.created_at)}
          </Small>
        </View>
        {a.payload?.reason ? <Text style={[type.bodyMedium, { color: role.onSurface }]}>Reason: {a.payload.reason}</Text> : null}
      </View>

      {done ? <Notice tone={done.startsWith('Done') ? 'ok' : 'info'} text={done} /> : null}
      {a.status === 'failed' && a.error ? <Notice tone="bad" text={`Failed: ${a.error}`} /> : null}

      <AiReviewCard review={data.review} />
      <SubjectView s={data.subject} action={a} />
      <RiskCard risk={data.risk} />

      {pending ? (
        <Card style={{ gap: 4 }}>
          <SectionTitle title="Your decision" />
          {!a.can_decide ? <Notice tone="warn" text="Your role can't decide this type. Someone with the right role has to." /> : null}
          {isSplit && a.can_decide ? (
            <Field
              label={`Change the buyer's share (taka, out of ${tk(dealAmount)})`}
              hint={a.payload?.buyer_paisa != null ? `Now: buyer ${tk(a.payload.buyer_paisa)}, seller ${tk(a.payload.seller_paisa)}. Leave empty to keep it.` : undefined}
              value={buyer}
              onChangeText={(t) => setBuyer(t.replace(/[^\d.]/g, ''))}
              keyboardType="decimal-pad"
            />
          ) : null}
          <Field label="Note (needed to reject)" value={note} onChangeText={setNote} multiline style={{ minHeight: 72, textAlignVertical: 'top' }} maxLength={500} />
          <ErrorText text={act.error} />
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Button title={approveWord[a.type] || 'Approve'} icon="check" onPress={() => decide('approve')} loading={act.busy === 'approve'} disabled={!a.can_decide || !!act.busy} style={{ flexGrow: 1 }} />
            <Button title="Reject" variant="danger" icon="x-mark" onPress={() => decide('reject')} loading={act.busy === 'reject'} disabled={!a.can_decide || !note.trim() || !!act.busy} style={{ flexGrow: 1 }} />
          </View>
          <Small>Approving runs it straight away and is written to the audit log.</Small>
        </Card>
      ) : (
        <Card>
          <SectionTitle title="Decision" />
          <KV k="By" v={a.decided_by_name || '—'} />
          <KV k="When" v={dateTime(a.decided_at)} />
          {a.decision_note ? <KV k="Note" v={a.decision_note} /> : null}
          {a.type === 'police_handover' && a.status === 'executed' ? (
            <Button
              small
              variant="ghost"
              icon="arrow-down-tray"
              title="Download police export"
              onPress={() =>
                act.run('exp', async () => {
                  if (Platform.OS !== 'web') {
                    setDone('Open the admin on the web to download the PDF.');
                    return;
                  }
                  const res = await fetch(api.url(`/api/admin/police-export/${a.id}`), { headers: { authorization: `Bearer ${adminToken}` } });
                  if (!res.ok) throw new Error('The export could not be downloaded.');
                  const blob = await res.blob();
                  const href = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = href;
                  link.download = `handover-${String(a.subject_id).slice(0, 8)}.pdf`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(href), 10000);
                  setDone('Downloaded. The download is recorded in the audit log.');
                })
              }
            />
          ) : null}
        </Card>
      )}

      {(data.history || []).length ? (
        <Card>
          <SectionTitle title="Earlier actions on this" />
          {data.history.map((h: Row) => (
            <KV key={h.id} k={actionLabel[h.type] || h.type} v={`${titleCase(h.status)}${h.by ? ` by ${h.by}` : ''}`} />
          ))}
        </Card>
      ) : null}
      <Button title="Back to the queue" variant="ghost" icon="arrow-left" onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin/queue'))} />
    </Page>
  );
}

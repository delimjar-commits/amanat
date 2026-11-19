import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AiReviewCard, ListRow, Small, useAdmin } from '../../../components/admin';
import { DealEvidence, DealFacts, UserLine } from '../../../components/adminSubject';
import { Loader, Notice, Segmented } from '../../../components/bits';
import { Text } from '../../../components/Text';
import { Button, Card, ErrorText, Field, Page, SectionTitle } from '../../../components/ui';
import { clock, dateTime, titleCase, tk } from '../../../lib/format';
import { useAction, useLoad } from '../../../lib/hooks';
import { actionLabel } from '../../../lib/status';
import { accent, role, type } from '../../../lib/theme';
import type { Row } from '../../../lib/types';

type To = 'refund' | 'release' | 'split';

export default function AdminDeal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, admin, isSuper } = useAdmin();
  const { data, error, loading, reload } = useLoad(() => api.get<Row>(`/api/admin/deals/${id}`), [id]);
  const [review, setReview] = useState<Row | null>(null);
  const [to, setTo] = useState<To>('refund');
  const [buyer, setBuyer] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  if (loading && !data) return <Loader />;
  if (!data) return <Page><ErrorText text={error || 'Not found'} /></Page>;
  const d = data.deal;
  const canResolve = isSuper || admin?.role === 'dispute_agent';
  const open = data.dispute && data.dispute.status !== 'resolved';

  const analyze = () => act.run('ai', async () => setReview((await api.post<{ review: Row }>(`/api/admin/disputes/${data.dispute.id}/analyze`)).review));
  const resolve = () =>
    act.run('resolve', async () => {
      const r = await api.post<{ action: Row }>(`/api/admin/deals/${id}/resolve`, { to, buyer_paisa: to === 'split' ? Math.round(Number(buyer) * 100) : undefined });
      setMsg('Sent to the approvals queue. A second click there carries it out.');
      reload();
      if (r.action?.id) router.push(`/admin/action/${r.action.id}`);
    });

  return (
    <Page gap={12}>
      <DealFacts d={d} />
      <UserLine u={data.buyer} label="Buyer" />
      <UserLine u={data.seller} label="Seller" />
      {open && canResolve ? (
        <Card style={{ gap: 6 }}>
          <SectionTitle title="Settle the dispute" />
          <Small>Ask the AI to read both sides and suggest refund, release or split. It only recommends. You pick, then approve it in the queue.</Small>
          <Button small variant="agent" icon="sparkles" title={review ? 'Ask again' : 'Ask the AI'} onPress={analyze} loading={act.busy === 'ai'} />
          <Segmented<To> value={to} onChange={setTo} options={[{ value: 'refund', label: 'Refund buyer' }, { value: 'release', label: 'Pay seller' }, { value: 'split', label: 'Split' }]} />
          {to === 'split' ? <Field label={`Buyer gets back (taka, out of ${tk(d.amount_paisa)})`} value={buyer} onChangeText={(t) => setBuyer(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" /> : null}
          <ErrorText text={act.error} />
          <Button title="Send to approvals" icon="paper-airplane" onPress={resolve} loading={act.busy === 'resolve'} disabled={to === 'split' && !buyer} />
        </Card>
      ) : null}
      {msg ? <Notice tone="ok" text={msg} /> : null}
      <AiReviewCard review={review} />
      <DealEvidence s={data} />
      {(data.actions || []).length ? (
        <View style={{ gap: 8 }}>
          <SectionTitle title="Admin actions" />
          {data.actions.map((a: Row) => (
            <ListRow key={a.id} icon="clipboard-document-check" title={actionLabel[a.type] || a.type} sub={`${titleCase(a.status)}${a.by ? ` by ${a.by}` : ''} · ${dateTime(a.decided_at || a.created_at)}`} onPress={() => router.push(`/admin/action/${a.id}`)} />
          ))}
        </View>
      ) : null}
      {(data.ledger || []).length ? (
        <Card>
          <SectionTitle title="Ledger" />
          {data.ledger.map((e: Row) => (
            <View key={e.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 3 }}>
              <Text style={[type.bodySmall, { color: role.onSurface, flex: 1 }]} numberOfLines={2}>
                {titleCase(e.account)} · {e.memo}
              </Text>
              <Text style={[type.bodySmall, { color: Number(e.debit_paisa) ? accent.green : accent.red }]}>{Number(e.debit_paisa) ? `+${tk(e.debit_paisa)}` : `−${tk(e.credit_paisa)}`}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      {(data.messages || []).length ? (
        <Card>
          <SectionTitle title="Chat" />
          {data.messages.map((m: Row, i: number) => (
            <View key={i} style={{ paddingVertical: 4 }}>
              <Small>
                {m.sender || 'System'} · {clock(m.created_at)}
                {m.ai_flag ? ' · flagged' : ''}
              </Small>
              <Text style={[type.bodyMedium, { color: m.ai_flag ? accent.red : role.onSurface }]}>{m.kind === 'image' ? '[photo]' : m.body}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </Page>
  );
}

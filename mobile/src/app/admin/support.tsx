import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { ListRow, Small, useAdmin } from '../../components/admin';
import { Loader } from '../../components/bits';
import { Text } from '../../components/Text';
import { Button, Card, Empty, ErrorText, Field, Page, SectionTitle, Tag } from '../../components/ui';
import { clock, timeAgo, titleCase } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { accent, role, type } from '../../lib/theme';
import type { Row } from '../../lib/types';

function Ticket({ id, onDone }: { id: string; onDone: () => void }) {
  const { api } = useAdmin();
  const { data, loading, reload } = useLoad(() => api.get<Row>(`/api/admin/support/${id}`), [id]);
  const [body, setBody] = useState('');
  const act = useAction();
  const send = (close: boolean) =>
    act.run(close ? 'close' : 'send', async () => {
      await api.post(`/api/admin/support/${id}/reply`, { body: body.trim(), close });
      setBody('');
      reload();
      if (close) onDone();
    });
  if (loading && !data) return <Loader />;
  return (
    <Card style={{ gap: 6 }}>
      <SectionTitle title={data?.ticket?.subject || 'Ticket'} right={<Tag text={titleCase(data?.ticket?.status || '')} color={accent.sky} />} />
      {(data?.messages || []).map((m: Row, i: number) => (
        <View key={i} style={{ alignSelf: m.role === 'user' ? 'flex-start' : 'flex-end', maxWidth: '85%', backgroundColor: m.role === 'user' ? role.surfaceContainerHigh : role.primaryContainer, padding: 10, borderRadius: 14 }}>
          <Small>
            {m.role === 'user' ? data?.ticket?.display_name : m.role === 'admin' ? 'Staff' : 'Helper'} · {clock(m.created_at)}
          </Small>
          <Text style={[type.bodyMedium, { color: role.onSurface }]}>{m.body}</Text>
        </View>
      ))}
      <Field label="Reply" value={body} onChangeText={setBody} multiline style={{ minHeight: 64, textAlignVertical: 'top' }} maxLength={2000} />
      <ErrorText text={act.error} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button small title="Send" icon="paper-airplane" onPress={() => send(false)} disabled={!body.trim()} loading={act.busy === 'send'} />
        <Button small variant="ghost" title={body.trim() ? 'Send and close' : 'Close ticket'} onPress={() => send(true)} loading={act.busy === 'close'} />
      </View>
    </Card>
  );
}

export default function Support() {
  const { api } = useAdmin();
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, refreshing, refresh, reload } = useLoad(() => api.get<{ tickets: Row[] }>('/api/admin/support'));
  return (
    <Page refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} gap={10}>
      <ErrorText text={error} />
      {open ? <Ticket id={open} onDone={() => { setOpen(null); reload(); }} /> : null}
      {loading && !data ? (
        <Loader />
      ) : (data?.tickets || []).length ? (
        data!.tickets.map((t) => (
          <ListRow key={t.id} icon="lifebuoy" color={t.status === 'open' ? accent.amber : accent.green} title={`${t.display_name} · ${t.subject}`} sub={`${t.last || ''}\n${timeAgo(t.created_at)}`} onPress={() => setOpen(t.id)} badge={<Tag text={titleCase(t.status)} color={t.status === 'open' ? accent.amber : accent.green} />} />
        ))
      ) : (
        <Empty icon="lifebuoy" title="No help tickets" />
      )}
    </Page>
  );
}

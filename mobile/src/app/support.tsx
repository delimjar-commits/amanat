import { useMemo, useRef, useState } from 'react';
import { FlatList, Platform, View } from 'react-native';
import { Notice } from '../components/bits';
import { Composer } from '../components/Composer';
import { Text } from '../components/Text';
import { Button, ErrorText, useLayout } from '../components/ui';
import { clock } from '../lib/format';
import { useAction, useLoad } from '../lib/hooks';
import { useKeyboardInset, type ViewHandle } from '../lib/keyboard';
import { useSession } from '../lib/session';
import { palette, role, type } from '../lib/theme';
import type { Row } from '../lib/types';

export default function Support() {
  const { api } = useSession();
  const { gutter, column } = useLayout();
  const { data, setData, reload, error } = useLoad(() => api.get<{ messages: Row[]; ticket: Row | null }>('/api/support'), [], { pollMs: 10000 });
  const [draft, setDraft] = useState('');
  const act = useAction();
  const ref = useRef<ViewHandle>(null);
  const kb = useKeyboardInset(ref);
  const reversed = useMemo(() => [...(data?.messages || [])].reverse(), [data?.messages]);
  const send = () => {
    const body = draft.trim();
    if (!body || act.busy) return;
    setDraft('');
    setData((d) => (d ? { ...d, messages: [...d.messages, { role: 'user', body, created_at: new Date().toISOString() }] } : d));
    act.run('send', async () => {
      await api.post('/api/support', { body });
      reload();
    });
  };
  return (
    <View ref={ref} style={{ flex: 1, backgroundColor: role.background, paddingBottom: kb }}>
      <View style={[column, { paddingHorizontal: gutter, paddingTop: 10, gap: 8 }]}>
        {data?.ticket ? (
          <Notice text={`A team member has your request "${data.ticket.subject}". Replies show up here.`} icon="lifebuoy" />
        ) : (
          <Button
            title="Talk to a person"
            icon="user"
            variant="ghost"
            small
            loading={act.busy === 'human'}
            onPress={() =>
              act.run('human', async () => {
                await api.post('/api/support/human', { subject: draft.trim() || 'Help with my account' });
                reload();
              })
            }
          />
        )}
        <ErrorText text={error || act.error} />
      </View>
      <FlatList
        inverted
        data={reversed}
        keyExtractor={(_, i) => String(i)}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : Platform.OS === 'web' ? 'none' : 'on-drag'}
        contentContainerStyle={[column, { paddingHorizontal: gutter, paddingVertical: 12, gap: 8 }]}
        ListFooterComponent={
          <View style={{ marginBottom: 8 }}>
            <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>Ask anything: how safe deals work, release codes, disputes, payouts. The helper answers right away, and a person can take over.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const mine = item.role === 'user';
          return (
            <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%', gap: 2 }}>
              {!mine ? <Text style={[type.labelSmall, { color: role.onSurfaceVariant }]}>{item.role === 'agent' ? 'Amanat team' : 'Helper'}</Text> : null}
              <View style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18, backgroundColor: mine ? palette.ink : role.surfaceContainerHigh }}>
                <Text style={[type.bodyLarge, { color: mine ? '#fff' : role.onSurface }]}>{item.body}</Text>
              </View>
              <Text style={[type.labelSmall, { color: role.onSurfaceVariant, alignSelf: mine ? 'flex-end' : 'flex-start' }]}>{clock(item.created_at)}</Text>
            </View>
          );
        }}
      />
      <Composer value={draft} onChangeText={setDraft} onSend={send} canSend={Boolean(draft.trim())} keyboardOpen={kb > 0} placeholder="Ask the helper" />
    </View>
  );
}

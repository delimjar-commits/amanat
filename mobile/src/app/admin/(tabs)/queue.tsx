import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { ActionRow, GROUPS, groupOf, useAdmin } from '../../../components/admin';
import { Loader, Notice, Segmented } from '../../../components/bits';
import { Text } from '../../../components/Text';
import { Button, Chip, Empty, ErrorText, Page } from '../../../components/ui';
import { useAction, useLoad } from '../../../lib/hooks';
import { role, type } from '../../../lib/theme';
import type { Row } from '../../../lib/types';

type St = 'pending' | 'executed' | 'rejected' | 'failed';

export default function Queue() {
  const { api } = useAdmin();
  const [status, setStatus] = useState<St>('pending');
  const [group, setGroup] = useState('all');
  const [sel, setSel] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  const { data, error, loading, refreshing, refresh, reload } = useLoad(() => api.get<{ actions: Row[] }>(`/api/admin/actions?status=${status}`), [status], { pollMs: 20000 });
  const all = data?.actions || [];
  const list = group === 'all' ? all : all.filter((a) => groupOf(a.type) === group);
  const eligible = list.filter((a) => a.bulk_ok && a.can_decide);

  const bulk = () =>
    act.run('bulk', async () => {
      const r = await api.post<{ results: Row[] }>('/api/admin/actions/bulk-approve', { ids: sel });
      const done = r.results.filter((x) => x.status === 'executed' || x.status === 'approved').length;
      setMsg(`${done} of ${sel.length} approved.${done < sel.length ? ' The rest were skipped. Open them one by one.' : ''}`);
      setSel([]);
      reload();
    });

  return (
    <Page inTabs refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} gap={12}>
      <Segmented<St>
        value={status}
        onChange={(v) => {
          setStatus(v);
          setSel([]);
        }}
        options={[
          { value: 'pending', label: 'Waiting' },
          { value: 'executed', label: 'Done' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'failed', label: 'Failed' },
        ]}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
        {GROUPS.map((g) => {
          const n = g.value === 'all' ? all.length : all.filter((a) => groupOf(a.type) === g.value).length;
          return <Chip key={g.value} label={`${g.label} ${n}`} icon={g.icon} selected={group === g.value} onPress={() => setGroup(g.value)} />;
        })}
      </ScrollView>
      {status === 'pending' && eligible.length ? (
        <Notice tone="ok" icon="bolt">
          <Text style={[type.bodyMedium, { color: role.onSurface }]}>
            {eligible.length} item{eligible.length > 1 ? 's are' : ' is'} low risk with a confident AI "approve". Tick them to approve together.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Button small variant="ghost" title={sel.length === eligible.length ? 'Clear' : 'Select all'} onPress={() => setSel(sel.length === eligible.length ? [] : eligible.map((a) => a.id))} />
            <Button small title={`Approve ${sel.length || ''}`.trim()} icon="check" disabled={!sel.length} loading={act.busy === 'bulk'} onPress={bulk} />
          </View>
        </Notice>
      ) : null}
      {msg ? <Notice tone="info" text={msg} /> : null}
      <ErrorText text={error || act.error} />
      {loading && !data ? (
        <Loader />
      ) : list.length ? (
        list.map((a) => <ActionRow key={a.id} a={a} selected={sel.includes(a.id)} onSelect={status === 'pending' && a.bulk_ok && a.can_decide ? () => setSel((p) => (p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id])) : undefined} />)
      ) : (
        <Empty icon="check-circle" title={status === 'pending' ? 'All clear' : 'Nothing here'} body={status === 'pending' ? 'Nothing is waiting for a decision.' : 'No items with this status yet.'} />
      )}
    </Page>
  );
}

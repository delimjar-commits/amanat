import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { ListRow, useAdmin } from '../../components/admin';
import { Loader, Segmented } from '../../components/bits';
import { Button, Empty, ErrorText, Page, Tag } from '../../components/ui';
import { timeAgo, titleCase } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { accent } from '../../lib/theme';
import type { Row } from '../../lib/types';
import { router } from 'expo-router';

export default function Alerts() {
  const { api } = useAdmin();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const act = useAction();
  const { data, error, loading, refreshing, refresh, reload } = useLoad(() => api.get<{ alerts: Row[] }>(`/api/admin/alerts${show === 'all' ? '?all=1' : ''}`), [show]);
  const resolve = (id: string) =>
    act.run(id, async () => {
      await api.post(`/api/admin/alerts/${id}/resolve`);
      reload();
    });
  return (
    <Page refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} gap={10}>
      <Segmented value={show} onChange={setShow} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
      <ErrorText text={error || act.error} />
      {loading && !data ? (
        <Loader />
      ) : (data?.alerts || []).length ? (
        data!.alerts.map((a) => (
          <View key={a.id} style={{ gap: 6 }}>
            <ListRow
              icon="bell-alert"
              color={a.resolved_at ? accent.green : a.priority <= 1 ? accent.red : accent.amber}
              title={a.title}
              sub={[a.body, `${titleCase(a.kind)} · ${timeAgo(a.created_at)}`].filter(Boolean).join('\n')}
              onPress={a.subject_type === 'deal' ? () => router.push(`/admin/deal/${a.subject_id}`) : a.subject_type === 'profile' ? () => router.push(`/admin/user/${a.subject_id}`) : undefined}
              badge={a.resolved_at ? <Tag text="Resolved" color={accent.green} /> : a.priority <= 1 ? <Tag text="Urgent" color={accent.red} /> : undefined}
            />
            {!a.resolved_at ? <Button small variant="ghost" icon="check" title="Mark resolved" onPress={() => resolve(a.id)} loading={act.busy === a.id} style={{ alignSelf: 'flex-end' }} /> : null}
          </View>
        ))
      ) : (
        <Empty icon="check-circle" title="No alerts" />
      )}
    </Page>
  );
}

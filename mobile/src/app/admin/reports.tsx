import { router } from 'expo-router';
import { RefreshControl, View } from 'react-native';
import { ListRow, useAdmin } from '../../components/admin';
import { Loader } from '../../components/bits';
import { Button, Empty, ErrorText, Page, Tag } from '../../components/ui';
import { timeAgo, titleCase } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { accent } from '../../lib/theme';
import type { Row } from '../../lib/types';

export default function Reports() {
  const { api } = useAdmin();
  const act = useAction();
  const { data, error, loading, refreshing, refresh, reload } = useLoad(() => api.get<{ reports: Row[] }>('/api/admin/reports'));
  const set = (id: string, status: 'upheld' | 'dismissed') =>
    act.run(id + status, async () => {
      await api.post(`/api/admin/reports/${id}`, { status });
      reload();
    });
  return (
    <Page refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} gap={10}>
      <ErrorText text={error || act.error} />
      {loading && !data ? (
        <Loader />
      ) : (data?.reports || []).length ? (
        data!.reports.map((r) => (
          <View key={r.id} style={{ gap: 6 }}>
            <ListRow
              icon="flag"
              color={r.status === 'open' ? accent.amber : accent.sky}
              title={r.target_listing ? `Listing: ${r.target_listing}` : r.target_user ? `User: ${r.target_user}` : r.target_message ? `Message: "${String(r.target_message).slice(0, 80)}"` : 'Report'}
              sub={`${r.reason}${r.details ? ` · ${r.details}` : ''}\nBy ${r.reporter || 'someone'} · ${timeAgo(r.created_at)}`}
              onPress={r.target_user_id ? () => router.push(`/admin/user/${r.target_user_id}`) : undefined}
              badge={<Tag text={titleCase(r.status)} color={r.status === 'open' ? accent.amber : r.status === 'upheld' ? accent.red : accent.green} />}
            />
            {r.status === 'open' ? (
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                <Button small variant="ghost" title="Dismiss" onPress={() => set(r.id, 'dismissed')} loading={act.busy === r.id + 'dismissed'} />
                <Button small variant="danger" title="Uphold" onPress={() => set(r.id, 'upheld')} loading={act.busy === r.id + 'upheld'} />
              </View>
            ) : null}
          </View>
        ))
      ) : (
        <Empty icon="flag" title="No reports" />
      )}
    </Page>
  );
}

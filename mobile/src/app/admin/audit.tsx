import { RefreshControl, View } from 'react-native';
import { Small, useAdmin } from '../../components/admin';
import { Loader } from '../../components/bits';
import { Text } from '../../components/Text';
import { Empty, ErrorText, Page } from '../../components/ui';
import { dateTime, titleCase } from '../../lib/format';
import { useLoad } from '../../lib/hooks';
import { role, type } from '../../lib/theme';
import type { Row } from '../../lib/types';

export default function Audit() {
  const { api } = useAdmin();
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.get<{ entries: Row[] }>('/api/admin/audit'));
  if (loading && !data) return <Loader />;
  return (
    <Page refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} gap={0}>
      <ErrorText text={error} />
      {(data?.entries || []).length ? (
        data!.entries.map((e) => (
          <View key={e.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: role.outlineVariant, gap: 2 }}>
            <Text style={[type.titleSmall, { color: role.onSurface }]}>{titleCase(String(e.action).replace(/:/g, ' · '))}</Text>
            <Small>
              {e.actor || titleCase(e.actor_kind)} · {dateTime(e.created_at)}
              {e.subject_type ? ` · ${e.subject_type}` : ''}
              {e.ip ? ` · ${e.ip}` : ''}
            </Small>
            {e.data ? (
              <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]} numberOfLines={3}>
                {JSON.stringify(e.data)}
              </Text>
            ) : null}
          </View>
        ))
      ) : (
        <Empty icon="document-text" title="Nothing logged yet" />
      )}
    </Page>
  );
}

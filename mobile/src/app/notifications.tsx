import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { Loader } from '../components/bits';
import { Icon } from '../components/Icon';
import { Text } from '../components/Text';
import { Empty, ErrorText, Page } from '../components/ui';
import { timeAgo } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { fonts, radius, role, tint, type } from '../lib/theme';
import type { Row } from '../lib/types';

export default function Notifications() {
  const { api, refreshMe } = useSession();
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.get<{ notifications: Row[] }>('/api/notifications'), []);
  useEffect(() => {
    if (data?.notifications.some((n) => !n.read_at)) api.post('/api/notifications/read').then(refreshMe).catch(() => {});
  }, [data, api, refreshMe]);
  return (
    <Page gap={8} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <ErrorText text={error} />
      {loading && !data ? (
        <Loader />
      ) : !data?.notifications.length ? (
        <Empty icon="bell" title="All caught up" body="Deal updates and messages from our team show up here." />
      ) : (
        data.notifications.map((n) => {
          const dealId = n.data?.deal_id;
          return (
            <Pressable
              key={n.id}
              disabled={!dealId}
              onPress={() => dealId && router.push(`/deal/${dealId}`)}
              style={{ flexDirection: 'row', gap: 12, padding: 12, borderRadius: radius.tile, backgroundColor: n.read_at ? role.surface : tint(role.primary, 0.06), borderWidth: 1, borderColor: role.outlineVariant }}
            >
              <Icon name={dealId ? 'shield-check' : 'bell'} size={22} color={role.primary} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[type.titleSmall, { fontFamily: n.read_at ? fonts.medium : fonts.bold }]}>{n.title}</Text>
                <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>{n.body}</Text>
                <Text style={[type.labelSmall, { color: role.onSurfaceVariant }]}>{timeAgo(n.created_at)}</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </Page>
  );
}

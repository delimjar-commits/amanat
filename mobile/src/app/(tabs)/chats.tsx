import { router } from 'expo-router';
import { Pressable, RefreshControl, View } from 'react-native';
import { Loader, UserAvatar } from '../../components/bits';
import { Text } from '../../components/Text';
import { Empty, ErrorText, Page } from '../../components/ui';
import { timeAgo, tk } from '../../lib/format';
import { useLoad } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { fonts, radius, role, type } from '../../lib/theme';
import type { Row } from '../../lib/types';

export default function Chats() {
  const { api, me } = useSession();
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.get<{ chats: Row[] }>('/api/chats'), [], { pollMs: 10000 });
  return (
    <Page inTabs gap={8} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <ErrorText text={error} />
      {loading && !data ? (
        <Loader />
      ) : !data?.chats.length ? (
        <Empty icon="chat-bubble-left-right" title="No chats yet" body="Open a listing and tap Chat with seller to start." />
      ) : (
        data.chats.map((c) => {
          const preview = c.last_kind === 'image' ? 'Photo' : c.last_kind === 'deal_card' ? 'Deal update' : c.last_body || 'Say hello';
          const mineLast = c.last_sender === me?.user.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => router.push(`/chat/${c.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Chat with ${c.other?.display_name}${c.unread ? `, ${c.unread} unread` : ''}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.tile, backgroundColor: pressed ? role.surfaceContainerHigh : role.surface, borderWidth: 1, borderColor: role.outlineVariant })}
            >
              <UserAvatar user={c.other} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[type.titleSmall, { flex: 1 }]} numberOfLines={1}>
                    {c.other?.display_name}
                  </Text>
                  <Text style={[type.labelSmall, { color: role.onSurfaceVariant }]}>{timeAgo(c.last_at)}</Text>
                </View>
                {c.listing_title ? (
                  <Text style={[type.labelMedium, { color: role.primary }]} numberOfLines={1}>
                    {c.listing_title} · {tk(c.listing_price)}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[type.bodyMedium, { flex: 1, color: c.unread ? role.onSurface : role.onSurfaceVariant, fontFamily: c.unread ? fonts.semibold : fonts.regular }]} numberOfLines={1}>
                    {mineLast ? 'You: ' : ''}
                    {preview}
                  </Text>
                  {c.unread ? (
                    <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: role.primary, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 11, fontFamily: fonts.semibold }}>{c.unread}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        })
      )}
    </Page>
  );
}

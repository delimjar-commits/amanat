import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { Loader, Segmented, UserAvatar } from '../../components/bits';
import { Text } from '../../components/Text';
import { Empty, ErrorText, Page, StatusPill } from '../../components/ui';
import { timeAgo, tk } from '../../lib/format';
import { useLoad } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { fonts, radius, role, type } from '../../lib/theme';
import type { Row } from '../../lib/types';

const CLOSED = ['completed', 'paid_out', 'cancelled', 'refunded', 'split_done', 'released'];

export default function Deals() {
  const { api } = useSession();
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.get<{ deals: Row[] }>('/api/deals'), [], { pollMs: 15000 });
  const list = (data?.deals || []).filter((d) => (tab === 'open' ? !CLOSED.includes(d.status) : CLOSED.includes(d.status)));
  return (
    <Page inTabs gap={10} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'open', label: 'In progress' },
          { value: 'closed', label: 'Finished' },
        ]}
      />
      <ErrorText text={error} />
      {loading && !data ? (
        <Loader />
      ) : !list.length ? (
        <Empty icon="shield-check" title={tab === 'open' ? 'No deals in progress' : 'No finished deals yet'} body="Start a safe deal from any chat. The money is held until the buyer confirms." />
      ) : (
        list.map((d) => (
          <Pressable
            key={d.id}
            onPress={() => router.push(`/deal/${d.id}`)}
            accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: radius.tile, backgroundColor: pressed ? role.surfaceContainerHigh : role.surface, borderWidth: 1, borderColor: role.outlineVariant })}
          >
            <UserAvatar user={d.other} size={44} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text style={type.titleSmall} numberOfLines={1}>
                {d.title}
              </Text>
              <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]} numberOfLines={1}>
                {d.role === 'buyer' ? 'Buying from' : 'Selling to'} {d.other?.display_name} · {timeAgo(d.created_at)}
              </Text>
              <StatusPill status={d.status} />
            </View>
            <Text style={[type.titleMedium, { fontFamily: fonts.bold }]}>{tk(d.amount_paisa)}</Text>
          </Pressable>
        ))
      )}
    </Page>
  );
}

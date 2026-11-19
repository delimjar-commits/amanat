import { router } from 'expo-router';
import { Pressable, RefreshControl, View } from 'react-native';
import { Loader, Photo } from '../components/bits';
import { Text } from '../components/Text';
import { Button, Empty, ErrorText, Page, StatusPill } from '../components/ui';
import { tk } from '../lib/format';
import { useAction, useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { accent, fonts, radius, role, tint, type } from '../lib/theme';
import type { Listing } from '../lib/types';

const lstatus: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Live', color: accent.green, bg: tint(accent.green, 0.13) },
  paused: { label: 'Paused', color: role.onSurfaceVariant, bg: role.surfaceContainerHigh },
  sold: { label: 'Sold', color: accent.sky, bg: tint(accent.sky, 0.13) },
  pending_review: { label: 'Being checked', color: accent.amber, bg: tint(accent.amber, 0.13) },
  removed: { label: 'Removed', color: accent.red, bg: tint(accent.red, 0.13) },
};

export default function MyListings() {
  const { api } = useSession();
  const { data, error, loading, refreshing, refresh, reload } = useLoad(() => api.get<{ listings: Listing[] }>('/api/listings/mine'), []);
  const act = useAction();
  const setStatus = (id: string, status: string) =>
    act.run(id + status, async () => {
      await api.patch(`/api/listings/${id}`, { status });
      reload();
    });
  return (
    <Page gap={10} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <ErrorText text={error || act.error} />
      {loading && !data ? (
        <Loader />
      ) : !data?.listings.length ? (
        <Empty icon="tag" title="No listings yet" body="Tap Sell to list your first item." action={<Button title="Sell something" onPress={() => router.push('/sell')} />} />
      ) : (
        data.listings.map((l) => (
          <View key={l.id} style={{ padding: 12, gap: 10, borderRadius: radius.tile, backgroundColor: role.surface, borderWidth: 1, borderColor: role.outlineVariant }}>
            <Pressable onPress={() => router.push(`/listing/${l.id}`)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Photo url={l.photos?.[0]?.url} style={{ width: 64, height: 64, borderRadius: radius.md }} />
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={type.titleSmall} numberOfLines={1}>
                  {l.title}
                </Text>
                <Text style={[type.titleSmall, { fontFamily: fonts.bold }]}>{tk(l.price_paisa)}</Text>
                <StatusPill s={lstatus[l.status]} status={l.status} />
              </View>
            </Pressable>
            {['active', 'paused'].includes(l.status) ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button small variant="ghost" title={l.status === 'active' ? 'Pause' : 'Make live'} onPress={() => setStatus(l.id, l.status === 'active' ? 'paused' : 'active')} loading={act.busy?.startsWith(l.id)} style={{ flex: 1 }} />
                <Button small variant="ghost" title="Mark sold" onPress={() => setStatus(l.id, 'sold')} style={{ flex: 1 }} />
              </View>
            ) : null}
          </View>
        ))
      )}
    </Page>
  );
}

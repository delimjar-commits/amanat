import { Linking, Platform, Pressable, View } from 'react-native';
import { Loader, Notice } from '../components/bits';
import { Icon } from '../components/Icon';
import { Text } from '../components/Text';
import { Empty, ErrorText, Page } from '../components/ui';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { accent, radius, role, type } from '../lib/theme';
import type { Row } from '../lib/types';

export default function SafeSpots() {
  const { api } = useSession();
  const { data, error, loading } = useLoad(() => api.get<{ spots: Row[] }>('/api/safe-spots'), []);
  const open = (s: Row) => {
    const q = `${s.lat},${s.lng}`;
    const url = Platform.OS === 'android' ? `geo:${q}?q=${q}(${encodeURIComponent(s.name)})` : `https://maps.google.com/?q=${q}`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${q}`));
  };
  return (
    <Page gap={10}>
      <Notice icon="shield-check" text="Meet in busy, well-lit places with CCTV, in daylight if you can. Tell a friend with Share trip on the deal." />
      <ErrorText text={error} />
      {loading && !data ? (
        <Loader />
      ) : !data?.spots.length ? (
        <Empty icon="map-pin" title="No spots added yet" />
      ) : (
        data.spots.map((s) => (
          <Pressable key={s.id} onPress={() => open(s)} accessibilityRole="link" style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: radius.tile, backgroundColor: role.surface, borderWidth: 1, borderColor: role.outlineVariant }}>
            <Icon name="map-pin" size={24} color={accent.green} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type.titleSmall}>{s.name}</Text>
              <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>
                {[s.kind, s.area, s.city].filter(Boolean).join(' · ')}
              </Text>
              {s.note ? <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>{s.note}</Text> : null}
            </View>
            <Icon name="arrow-top-right-on-square" size={18} color={role.onSurfaceVariant} />
          </Pressable>
        ))
      )}
    </Page>
  );
}

import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { Grid, ListingCard, Loader, Notice } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { Chip, Empty, ErrorText, HeroCard, Page, SectionTitle, useLayout } from '../../components/ui';
import { useLoad } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { fonts, radius, role, type } from '../../lib/theme';
import type { Listing } from '../../lib/types';

const sorts = [
  { v: 'new', l: 'Newest' },
  { v: 'price_asc', l: 'Lowest price' },
  { v: 'price_desc', l: 'Highest price' },
  { v: 'trust', l: 'Most trusted' },
];

export default function Browse() {
  const { api, config, me } = useSession();
  const { width, gutter } = useLayout();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [sort, setSort] = useState('new');
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (cat) params.set('category', cat);
  if (verified) params.set('verified', '1');
  if (sort !== 'new') params.set('sort', sort);
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.get<{ listings: Listing[] }>(`/api/listings?${params}`), [query, cat, verified, sort]);
  const contentW = Math.min(width, 1080 + gutter * 2) - gutter * 2 - (width >= 840 ? 96 : 0);
  const level = me?.user.kyc_level || 'none';

  return (
    <Page inTabs gap={14} maxWidth={1080} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: role.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: role.outlineVariant, paddingLeft: 14, paddingRight: 6, minHeight: 50 }}>
        <Icon name="magnifying-glass" size={20} color={role.onSurfaceVariant} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search phones, bikes, services…"
          placeholderTextColor={role.onSurfaceVariant}
          returnKeyType="search"
          onSubmitEditing={() => setQuery(q.trim())}
          accessibilityLabel="Search listings"
          style={{ flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 16, color: role.onSurface, paddingVertical: 12, outlineStyle: 'none' } as never}
        />
        {q ? (
          <Pressable
            onPress={() => {
              setQ('');
              setQuery('');
            }}
            accessibilityLabel="Clear search"
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="x-mark" size={18} color={role.onSurfaceVariant} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
        <Chip label="All" selected={!cat} onPress={() => setCat(null)} />
        {(config?.categories || []).map((c) => (
          <Chip key={c} label={c} selected={cat === c} onPress={() => setCat(cat === c ? null : c)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
        <Chip label="NID verified only" icon="check-badge" selected={verified} onPress={() => setVerified(!verified)} />
        {sorts.map((s) => (
          <Chip key={s.v} label={s.l} selected={sort === s.v} onPress={() => setSort(s.v)} />
        ))}
      </ScrollView>

      {level === 'none' || level === 'basic' ? (
        <HeroCard
          title={level === 'none' ? 'Verify your phone to start' : 'Verify your NID'}
          sub={level === 'none' ? 'You need a verified phone before you can chat or make a deal.' : 'Raise your deal limit and get the verified badge.'}
          icon="identification"
          onPress={() => router.push('/verify')}
        />
      ) : null}

      <Pressable onPress={() => router.push('/wanted')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: role.surfaceContainerLow }}>
        <Icon name="megaphone" size={20} color={role.primary} />
        <Text style={[type.bodyMedium, { flex: 1 }]}>Can't find it? See what people want, or post a Wanted ad.</Text>
        <Icon name="chevron-right" size={18} color={role.onSurfaceVariant} />
      </Pressable>

      <SectionTitle title={query ? `Results for "${query}"` : cat || 'Latest listings'} />
      <ErrorText text={error} />
      {loading && !data ? (
        <Loader />
      ) : data?.listings.length ? (
        <Grid items={data.listings} width={contentW} min={160} render={(l, w) => <ListingCard key={l.id} l={l} width={w} />} />
      ) : (
        <Empty icon="shopping-bag" title="Nothing here yet" body={query || cat ? 'Try another search or category.' : 'Be the first to list something. Tap Sell.'} />
      )}
      {config?.sandbox ? <Notice text="Test mode: payments use test money only. No real bKash, Nagad or card charges happen." /> : null}
    </Page>
  );
}

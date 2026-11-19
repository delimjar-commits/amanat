import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { KV, Loader, Notice, Photo, SellerLine } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { Button, Card, ErrorText, Page, SectionTitle, useLayout } from '../../components/ui';
import { tk, titleCase } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { accent, fonts, radius, role, type } from '../../lib/theme';
import type { Listing } from '../../lib/types';

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, me } = useSession();
  const { width, gutter } = useLayout();
  const { data, setData, error, loading } = useLoad(() => api.get<{ listing: Listing & { seller_rating?: { avg: number; n: number } } }>(`/api/listings/${id}`), [id]);
  const act = useAction();
  const [reported, setReported] = useState(false);
  const l = data?.listing;
  if (loading && !l) return <Loader />;
  if (!l)
    return (
      <Page>
        <ErrorText text={error || 'This listing is not available.'} />
      </Page>
    );
  const mine = l.seller_id === me?.user.id;
  const photoW = Math.min(width - gutter * 2, 720);

  const chat = () =>
    act.run('chat', async () => {
      const r = await api.post<{ chat_id: string }>('/api/chats', { listing_id: l.id });
      router.push(`/chat/${r.chat_id}`);
    });
  const save = () =>
    act.run('save', async () => {
      const r = await api.post<{ saved: boolean }>(`/api/listings/${l.id}/save`);
      setData({ listing: { ...l, saved: r.saved } });
    });
  const report = () =>
    act.run('report', async () => {
      await api.post('/api/reports', { listing_id: l.id, reason: 'Looks like a scam or fake listing' });
      setReported(true);
    });

  return (
    <Page gap={14}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ borderRadius: radius.hero, width: photoW, alignSelf: 'center' }}>
        {(l.photos.length ? l.photos : [{ id: 'none', url: null }]).map((p) => (
          <Photo key={p.id} url={p.url} style={{ width: photoW, height: Math.min(photoW, 420) }} />
        ))}
      </ScrollView>
      {l.photos.length > 1 ? <Text style={[type.labelSmall, { color: role.onSurfaceVariant, textAlign: 'center' }]}>{l.photos.length} photos · swipe to see more</Text> : null}

      <View style={{ gap: 4 }}>
        <Text style={[type.headlineSmall, { fontFamily: fonts.extrabold }]}>{tk(l.price_paisa)}</Text>
        <Text style={type.titleLarge}>{l.title}</Text>
        <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>
          {[l.category, l.condition, l.location_area].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {l.status !== 'active' ? <Notice tone="warn" text={l.status === 'pending_review' ? 'This listing is being checked by our team before it goes live.' : `This listing is ${titleCase(l.status)}.`} /> : null}

      {!mine ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Chat with seller" icon="chat-bubble-left-right" onPress={chat} loading={act.busy === 'chat'} style={{ flex: 1 }} />
          <Button title={l.saved ? 'Saved' : 'Save'} icon="heart" variant="ghost" onPress={save} loading={act.busy === 'save'} />
        </View>
      ) : (
        <Button title="Manage my listings" variant="ghost" icon="pencil-square" onPress={() => router.push('/my-listings')} />
      )}
      <ErrorText text={act.error} />

      <Card>
        <SectionTitle title="Seller" />
        <SellerLine user={l.seller} />
        {data?.listing.seller_rating?.n ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Icon name="star" size={16} color={accent.amber} strokeWidth={2} />
            <Text style={type.bodyMedium}>
              {Number(data.listing.seller_rating.avg).toFixed(1)} from {data.listing.seller_rating.n} reviews
            </Text>
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionTitle title="About this item" />
        <Text style={[type.bodyLarge, { color: role.onSurface }]}>{l.description}</Text>
        <View style={{ marginTop: 10 }}>
          <KV k="Type" v={titleCase(l.deal_type)} />
          <KV k="Returns" v={l.return_days ? `${l.return_days} days` : 'No returns'} />
        </View>
      </Card>

      <Notice icon="lock-closed" text="Pay only inside Amanat. Your money is held until you check the item and confirm. Never send money by bKash or Nagad directly, and never share an OTP." />

      {!mine ? (
        <Button title={reported ? 'Reported. Thanks.' : 'Report this listing'} variant="ghost" icon="flag" small onPress={reported ? undefined : report} disabled={reported} loading={act.busy === 'report'} />
      ) : null}
    </Page>
  );
}

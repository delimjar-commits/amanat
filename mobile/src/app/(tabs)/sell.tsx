import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { Notice } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { Button, Card, Chip, ErrorText, Field, HeroCard, Page, SectionTitle } from '../../components/ui';
import { useAction } from '../../lib/hooks';
import { pickPhoto, upload } from '../../lib/media';
import { useSession } from '../../lib/session';
import { radius, role, type } from '../../lib/theme';

const TYPES = [
  { v: 'sale', l: 'For sale' },
  { v: 'service', l: 'Service' },
  { v: 'rental', l: 'Rental' },
  { v: 'trade', l: 'Trade' },
];
const CONDITIONS = ['New', 'Like new', 'Good', 'Fair'];

export default function Sell() {
  const { api, config, me } = useSession();
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [dealType, setDealType] = useState('sale');
  const [condition, setCondition] = useState('Good');
  const [area, setArea] = useState(me?.user.area || '');
  const [returns, setReturns] = useState('0');
  const [msg, setMsg] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const act = useAction();
  const level = me?.user.kyc_level || 'none';

  if (level === 'none') {
    return (
      <Page inTabs gap={14}>
        <HeroCard title="Verify your phone to sell" sub="It takes a minute. Then you can list items and take safe payments." icon="device-phone-mobile" onPress={() => router.push('/verify')} />
      </Page>
    );
  }

  const addPhoto = () =>
    act.run('photo', async () => {
      const p = await pickPhoto('gallery');
      if (!p) return;
      const f = await upload(api, p, 'listing-photos');
      setPhotos((x) => [...x, { id: f.id, uri: p.uri }].slice(0, 8));
    });
  const assist = () =>
    act.run('assist', async () => {
      const r = await api.post<{ title: string; description: string; category?: string | null; suggested_price_bdt?: number | null; price_note?: string }>('/api/listings/assist', { title, hints: description, category, condition });
      if (r.title) setTitle(r.title);
      if (r.description) setDescription(r.description);
      if (r.category && config?.categories.includes(r.category)) setCategory(r.category);
      if (r.suggested_price_bdt && !price) setPrice(String(r.suggested_price_bdt));
      setTip(r.price_note || null);
    });
  const submit = () =>
    act.run('submit', async () => {
      const r = await api.post<{ listing: { id: string }; message: string }>('/api/listings', {
        title: title.trim(),
        description: description.trim(),
        category,
        price: Number(price),
        deal_type: dealType,
        condition: dealType === 'sale' ? condition : undefined,
        location_area: area.trim(),
        return_days: Number(returns) || 0,
        photos: photos.map((p) => p.id),
      });
      setMsg(r.message);
      setPhotos([]);
      setTitle('');
      setDescription('');
      setPrice('');
      router.push(`/listing/${r.listing.id}`);
    });

  return (
    <Page inTabs gap={14}>
      {msg ? <Notice tone="ok" text={msg} /> : null}
      <Card>
        <SectionTitle title="Photos" right={<Text style={[type.labelMedium, { color: role.onSurfaceVariant }]}>{photos.length}/8</Text>} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {photos.map((p) => (
            <View key={p.id}>
              <Image source={{ uri: p.uri }} style={{ width: 96, height: 96, borderRadius: radius.md }} />
              <Pressable
                onPress={() => setPhotos((x) => x.filter((y) => y.id !== p.id))}
                accessibilityLabel="Remove photo"
                style={{ position: 'absolute', top: 4, right: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="x-mark" size={16} color="#fff" />
              </Pressable>
            </View>
          ))}
          {photos.length < 8 ? (
            <Pressable
              onPress={addPhoto}
              accessibilityRole="button"
              accessibilityLabel="Add photo"
              style={{ width: 96, height: 96, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: role.outline, alignItems: 'center', justifyContent: 'center', gap: 4 }}
            >
              <Icon name="camera" size={24} color={role.onSurfaceVariant} />
              <Text style={[type.labelSmall, { color: role.onSurfaceVariant }]}>{act.busy === 'photo' ? 'Uploading…' : 'Add photo'}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </Card>

      <Card>
        <View style={{ gap: 12 }}>
          <Field label="Title" placeholder="e.g. iPhone 13, 128GB, blue" value={title} onChangeText={setTitle} maxLength={90} />
          <Field label="Price (taka)" value={price} onChangeText={(t) => setPrice(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" />
          <Field label="Description" placeholder="Condition, what's included, why you're selling…" value={description} onChangeText={setDescription} multiline style={{ minHeight: 110 }} />
          <Button title="Write it for me" icon="sparkles" variant="ghost" small disabled={title.trim().length < 3} loading={act.busy === 'assist'} onPress={assist} />
          {tip ? <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>{tip}</Text> : null}
          <Text style={type.labelLarge}>Category</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(config?.categories || []).map((c) => (
              <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
            ))}
          </View>
          <Text style={type.labelLarge}>Type</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TYPES.map((t) => (
              <Chip key={t.v} label={t.l} selected={dealType === t.v} onPress={() => setDealType(t.v)} />
            ))}
          </View>
          {dealType === 'sale' ? (
            <>
              <Text style={type.labelLarge}>Condition</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {CONDITIONS.map((c) => (
                  <Chip key={c} label={c} selected={condition === c} onPress={() => setCondition(c)} />
                ))}
              </View>
            </>
          ) : null}
          <Field label="Area" placeholder="e.g. Dhanmondi, Dhaka" value={area} onChangeText={setArea} />
          <Field label="Return window (days, 0 for none)" value={returns} onChangeText={(t) => setReturns(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
        </View>
      </Card>
      <Notice icon="sparkles" text="Every new listing gets a quick automatic check for fake or banned items. Most go live straight away." />
      <ErrorText text={act.error} />
      <Button title="Publish listing" icon="check" onPress={submit} loading={act.busy === 'submit'} />
      <Text style={[type.bodySmall, { color: role.onSurfaceVariant, textAlign: 'center' }]}>Selling something fake, stolen or banned gets your account blocked.</Text>
    </Page>
  );
}

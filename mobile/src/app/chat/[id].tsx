import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Platform, Pressable, View } from 'react-native';
import { Notice, Segmented } from '../../components/bits';
import { Composer } from '../../components/Composer';
import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { Button, ErrorText, Field, IconButton, Sheet, StatusPill, useLayout } from '../../components/ui';
import { clock, tk } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { useKeyboardInset, type ViewHandle } from '../../lib/keyboard';
import { pickPhoto, upload } from '../../lib/media';
import { useSession } from '../../lib/session';
import { accent, fonts, palette, radius, role, tint, type } from '../../lib/theme';
import type { Row } from '../../lib/types';

type ChatData = { chat: Row; other: Row; messages: Row[]; deals: Row[] };

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, me, config } = useSession();
  const { gutter, column } = useLayout();
  const { data, setData, error, reload } = useLoad(() => api.get<ChatData>(`/api/chats/${id}`), [id], { pollMs: 5000 });
  const [draft, setDraft] = useState('');
  const [offerOpen, setOfferOpen] = useState(false);
  const act = useAction();
  const screenRef = useRef<ViewHandle>(null);
  const kb = useKeyboardInset(screenRef);
  const reversed = useMemo(() => [...(data?.messages || [])].reverse(), [data?.messages]);
  const myId = me?.user.id;
  const isSeller = data?.chat.listing_seller === myId;
  const openDeal = data?.deals.find((d) => !['cancelled', 'completed', 'paid_out', 'refunded', 'split_done'].includes(d.status));

  const send = () => {
    const body = draft.trim();
    if (!body || act.busy) return;
    setDraft('');
    act.run('send', async () => {
      const r = await api.post<{ message: Row }>(`/api/chats/${id}/messages`, { kind: 'text', body });
      setData((d) => (d ? { ...d, messages: [...d.messages, r.message] } : d));
      reload();
    });
  };
  const sendPhoto = () =>
    act.run('photo', async () => {
      const p = await pickPhoto('gallery');
      if (!p) return;
      const f = await upload(api, p, 'chat-media');
      await api.post(`/api/chats/${id}/messages`, { kind: 'image', media: f.id });
      reload();
    });

  return (
    <View ref={screenRef} style={{ flex: 1, backgroundColor: role.background, paddingBottom: kb }}>
      <Stack.Screen
        options={{
          title: data?.other?.display_name || 'Chat',
          headerRight: () => (data?.other ? <IconButton name="user-circle" label="View profile" onPress={() => router.push(`/user/${data.other.id}`)} /> : null),
        }}
      />
      {data?.chat.listing_title ? (
        <View style={[column, { paddingHorizontal: gutter, paddingTop: 8 }]}>
          <Pressable
            onPress={() => data.chat.listing_id && router.push(`/listing/${data.chat.listing_id}`)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, backgroundColor: role.surfaceContainerLow }}
          >
            <Icon name="tag" size={18} color={role.primary} />
            <Text style={[type.bodyMedium, { flex: 1 }]} numberOfLines={1}>
              {data.chat.listing_title}
            </Text>
            <Text style={[type.titleSmall, { fontFamily: fonts.bold }]}>{tk(data.chat.listing_price)}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={[column, { paddingHorizontal: gutter, paddingTop: 8, flexDirection: 'row', gap: 8 }]}>
        {openDeal ? (
          <Button title={`Open deal · ${tk(openDeal.amount_paisa)}`} icon="shield-check" small onPress={() => router.push(`/deal/${openDeal.id}`)} style={{ flex: 1 }} />
        ) : (
          <Button title={isSeller ? 'Offer a safe deal' : 'Make a safe deal'} icon="shield-check" small onPress={() => setOfferOpen(true)} style={{ flex: 1 }} />
        )}
      </View>
      <View style={[column, { paddingHorizontal: gutter }]}>
        <ErrorText text={error || act.error} />
      </View>
      <FlatList
        inverted
        data={reversed}
        keyExtractor={(m) => m.id}
        style={{ flex: 1 }}
        contentContainerStyle={[column, { paddingHorizontal: gutter, paddingVertical: 12, gap: 6 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : Platform.OS === 'web' ? 'none' : 'on-drag'}
        ListFooterComponent={
          <View style={{ marginBottom: 8 }}>
            <Notice icon="lock-closed" text="Keep the deal and payment inside Amanat. We never ask for your OTP or PIN." />
          </View>
        }
        renderItem={({ item }) => <Bubble m={item} mine={item.sender_id === myId} deals={data?.deals || []} />}
      />
      <Composer value={draft} onChangeText={setDraft} onSend={send} canSend={Boolean(draft.trim())} keyboardOpen={kb > 0} onPhoto={sendPhoto} />
      {data ? (
        <OfferSheet
          visible={offerOpen}
          onClose={() => setOfferOpen(false)}
          chat={data.chat}
          isSeller={isSeller}
          feePct={config?.fees.platform_fee_percent ?? 0}
          onDone={(dealId) => {
            setOfferOpen(false);
            router.push(`/deal/${dealId}`);
          }}
        />
      ) : null}
    </View>
  );
}

function Bubble({ m, mine, deals }: { m: Row; mine: boolean; deals: Row[] }) {
  if (m.kind === 'system' || m.kind === 'safety') {
    return (
      <View style={{ alignSelf: 'center', maxWidth: '90%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: tint(accent.amber, 0.14) }}>
        <Text style={[type.bodySmall, { color: role.onSurface, textAlign: 'center' }]}>{m.body}</Text>
      </View>
    );
  }
  if (m.kind === 'deal_card') {
    const d = deals.find((x) => x.id === m.deal_id);
    return (
      <Pressable
        onPress={() => router.push(`/deal/${m.deal_id}`)}
        accessibilityRole="button"
        style={{ alignSelf: mine ? 'flex-end' : 'flex-start', width: 260, maxWidth: '86%', padding: 12, gap: 6, borderRadius: radius.tile, backgroundColor: role.surface, borderWidth: 1, borderColor: palette.skyLight }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="shield-check" size={18} color={role.primary} />
          <Text style={[type.labelLarge, { color: role.primary }]}>Safe deal</Text>
        </View>
        <Text style={type.titleSmall}>{m.body}</Text>
        {d ? <StatusPill status={d.status} /> : null}
        <Text style={[type.labelMedium, { color: palette.link }]}>Open deal</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', gap: 4 }}>
      <View style={{ paddingHorizontal: m.kind === 'image' ? 4 : 12, paddingVertical: m.kind === 'image' ? 4 : 9, borderRadius: 18, borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6, backgroundColor: mine ? palette.ink : role.surfaceContainerHigh }}>
        {m.kind === 'image' && m.media_url ? <Image source={{ uri: m.media_url }} style={{ width: 200, height: 200, borderRadius: 14 }} /> : null}
        {m.body ? <Text style={[type.bodyLarge, { color: mine ? '#FFFFFF' : role.onSurface }]}>{m.body}</Text> : null}
      </View>
      {m.ai_flag ? (
        <View style={{ flexDirection: 'row', gap: 6, padding: 8, borderRadius: radius.sm, backgroundColor: tint(accent.red, 0.1), maxWidth: 300 }}>
          <Icon name="exclamation-triangle" size={16} color={accent.red} />
          <Text style={[type.bodySmall, { flex: 1, color: role.onSurface }]}>{typeof m.ai_flag === 'object' ? m.ai_flag.warning || m.ai_flag.reason || 'This message looks risky.' : 'This message looks risky.'}</Text>
        </View>
      ) : null}
      <Text style={[type.labelSmall, { color: role.onSurfaceVariant, alignSelf: mine ? 'flex-end' : 'flex-start' }]}>{clock(m.created_at)}</Text>
    </View>
  );
}

function OfferSheet({ visible, onClose, chat, isSeller, feePct, onDone }: { visible: boolean; onClose: () => void; chat: Row; isSeller: boolean; feePct: number; onDone: (id: string) => void }) {
  const { api } = useSession();
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [terms, setTerms] = useState('');
  const [handover, setHandover] = useState<'meetup' | 'courier'>('meetup');
  const act = useAction();
  useEffect(() => {
    if (visible) {
      setAmount(chat.listing_price ? String(Number(chat.listing_price) / 100) : '');
      setTitle(chat.listing_title || '');
    }
  }, [visible, chat.listing_price, chat.listing_title]);
  const n = Number(amount);
  const submit = () =>
    act.run('offer', async () => {
      if (!(n > 0)) throw new Error('Enter an amount above zero.');
      const r = await api.post<{ deal: Row }>('/api/deals', { chat_id: chat.id, role: isSeller ? 'seller' : 'buyer', amount: n, title: title.trim(), terms: terms.trim(), handover });
      onDone(r.deal.id);
    });
  return (
    <Sheet visible={visible} onClose={onClose} title="Make a safe deal">
      <View style={{ gap: 12 }}>
        <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>
          The buyer pays Amanat. We hold the money until the buyer confirms they got the item. The other person has to accept first.
        </Text>
        <Field label="What is the deal for?" value={title} onChangeText={setTitle} returnKeyType="next" />
        <Field label="Amount (taka)" value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" />
        {n > 0 ? (
          <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>
            Fee {feePct}% (about {tk(Math.round(n * feePct))}), taken from the seller's side when the money is released.
          </Text>
        ) : null}
        <Text style={type.labelLarge}>Handover</Text>
        <Segmented
          value={handover}
          onChange={setHandover}
          options={[
            { value: 'meetup', label: 'Meet in person' },
            { value: 'courier', label: 'Courier' },
          ]}
        />
        <Field label="Terms (optional)" placeholder="Condition, what's included, warranty…" value={terms} onChangeText={setTerms} multiline style={{ minHeight: 80 }} />
        <ErrorText text={act.error} />
        <Button title="Send offer" onPress={submit} loading={act.busy === 'offer'} />
      </View>
    </Sheet>
  );
}


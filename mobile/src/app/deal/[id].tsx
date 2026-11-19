import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Platform, Pressable, RefreshControl, View } from 'react-native';
import { KV, Loader, Notice, SellerLine } from '../../components/bits';
import { Icon, type HeroName } from '../../components/Icon';
import { Text } from '../../components/Text';
import { Button, Card, Chip, ErrorText, Field, Page, SectionTitle, Sheet, StatusPill } from '../../components/ui';
import { dateTime, titleCase, tk } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { getFix, pickPhoto, upload } from '../../lib/media';
import { useSession } from '../../lib/session';
import { accent, fonts, palette, radius, role, tint, type } from '../../lib/theme';
import type { Deal } from '../../lib/types';

const STEPS: { key: string; label: string; icon: HeroName; at: string[] }[] = [
  { key: 'offer', label: 'Offer', icon: 'document-text', at: ['proposed'] },
  { key: 'accepted', label: 'Accepted', icon: 'check-circle', at: ['accepted', 'payment_pending'] },
  { key: 'held', label: 'Money held', icon: 'lock-closed', at: ['funded', 'handover_pending', 'shipped'] },
  { key: 'confirmed', label: 'Confirmed', icon: 'hand-raised', at: ['buyer_confirmed', 'release_queued'] },
  { key: 'done', label: 'Paid out', icon: 'banknotes', at: ['released', 'paid_out', 'completed'] },
];
const stepIndex = (s: string) => STEPS.findIndex((x) => x.at.includes(s));
const ACTIVE = ['funded', 'handover_pending', 'shipped'];
const DONE = ['completed', 'paid_out', 'released', 'refunded', 'split_done'];

export default function DealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, me } = useSession();
  const { data, setData, error, loading, refreshing, refresh, reload } = useLoad(() => api.get<{ deal: Deal }>(`/api/deals/${id}`), [id], { pollMs: 8000 });
  const act = useAction();
  const [sheet, setSheet] = useState<null | 'code' | 'ship' | 'dispute' | 'evidence' | 'proof'>(null);
  const [note, setNote] = useState<string | null>(null);
  const d = data?.deal;
  if (loading && !d) return <Loader />;
  if (!d)
    return (
      <Page>
        <ErrorText text={error || 'Deal not found.'} />
      </Page>
    );
  const buyer = d.role === 'buyer';
  const other = buyer ? d.seller : d.buyer;
  const iProposed = d.proposed_by === me?.user.id;
  const set = (r: { deal: Deal }) => setData({ deal: r.deal });
  const post = (key: string, path: string, body: object = {}, msg?: string) =>
    act.run(key, async () => {
      set(await api.post<{ deal: Deal }>(`/api/deals/${d.id}/${path}`, body));
      if (msg) setNote(msg);
    });
  const idx = stepIndex(d.status);

  const pay = () =>
    act.run('pay', async () => {
      const r = await api.post<{ deal: Deal; pay_url: string }>(`/api/deals/${d.id}/pay`);
      set(r);
      const url = api.url(r.pay_url);
      if (Platform.OS === 'web') {
        window.location.href = url;
        return;
      }
      await WebBrowser.openBrowserAsync(url);
      reload();
    });

  const sos = () =>
    act.run('sos', async () => {
      let fix = null;
      try {
        fix = await getFix();
      } catch {}
      const r = await api.post<{ message: string }>(`/api/deals/${d.id}/sos`, fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : {});
      setNote(r.message);
    });
  const trip = () =>
    act.run('trip', async () => {
      let fix = null;
      try {
        fix = await getFix();
      } catch {}
      const r = await api.post<{ url: string }>(`/api/deals/${d.id}/trip-share`, fix ? { lat: fix.lat, lng: fix.lng } : {});
      const url = api.url(r.url);
      setNote(`Trip link ready: ${url}. Send it to a friend so they can follow the meetup.`);
      reload();
    });

  return (
    <Page gap={14} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Stack.Screen options={{ title: buyer ? 'Your purchase' : 'Your sale' }} />
      <Card>
        <View style={{ gap: 6 }}>
          <StatusPill status={d.status} />
          <Text style={type.titleLarge}>{d.title}</Text>
          <Text style={[type.headlineSmall, { fontFamily: fonts.extrabold }]}>{tk(d.amount_paisa)}</Text>
          <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>
            {d.handover === 'courier' ? 'Courier delivery' : 'Meet in person'} · started {dateTime(d.created_at)}
          </Text>
        </View>
        {idx >= 0 ? <Stepper idx={idx} /> : null}
      </Card>

      {note ? <Notice tone="ok" text={note} /> : null}
      <ErrorText text={act.error} />

      {/* What to do now */}
      <Card>
        <SectionTitle title="What happens now" />
        {d.status === 'proposed' ? (
          iProposed ? (
            <View style={{ gap: 10 }}>
              <Text style={type.bodyMedium}>Waiting for {other.display_name} to accept your offer.</Text>
              <Button title="Cancel offer" variant="ghost" onPress={() => post('cancel', 'cancel', { reason: 'Offer withdrawn' })} loading={act.busy === 'cancel'} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={type.bodyMedium}>
                {other.display_name} offered {tk(d.amount_paisa)}. If you accept, an agreement is made and {buyer ? 'you can pay into safe hold.' : 'the buyer can pay into safe hold.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="Accept" icon="check" onPress={() => post('accept', 'accept', {}, 'Deal accepted. The agreement is ready below.')} loading={act.busy === 'accept'} style={{ flex: 1 }} />
                <Button title="Decline" variant="ghost" onPress={() => post('cancel', 'cancel', { reason: 'Declined' })} loading={act.busy === 'cancel'} style={{ flex: 1 }} />
              </View>
            </View>
          )
        ) : null}

        {d.status === 'accepted' || d.status === 'payment_pending' ? (
          buyer ? (
            <View style={{ gap: 10 }}>
              <Text style={type.bodyMedium}>Pay {tk(d.amount_paisa)} into safe hold. The seller gets it only after you confirm you have the item.</Text>
              <Button title={`Pay ${tk(d.amount_paisa)}`} icon="lock-closed" onPress={pay} loading={act.busy === 'pay'} />
              <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>Test mode: this opens a test payment page. No real money moves.</Text>
              <Button title="Cancel deal" variant="ghost" small onPress={() => post('cancel', 'cancel', { reason: 'Buyer cancelled before paying' })} loading={act.busy === 'cancel'} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={type.bodyMedium}>Waiting for {other.display_name} to pay. Don't hand anything over until the status says Money held safely.</Text>
              <Button title="Cancel deal" variant="ghost" small onPress={() => post('cancel', 'cancel', { reason: 'Seller cancelled before payment' })} loading={act.busy === 'cancel'} />
            </View>
          )
        ) : null}

        {ACTIVE.includes(d.status) ? (
          buyer ? (
            <View style={{ gap: 12 }}>
              {d.release_code ? (
                <View style={{ alignItems: 'center', gap: 6, padding: 16, borderRadius: radius.tile, backgroundColor: palette.skyExtraLight }}>
                  <Text style={[type.labelLarge, { color: role.onSurfaceVariant }]}>Your release code</Text>
                  <Text accessibilityLabel={`Release code ${d.release_code.split('').join(' ')}`} style={{ fontFamily: fonts.extrabold, fontSize: 40, letterSpacing: 10, color: palette.ink }}>
                    {d.release_code}
                  </Text>
                  <Text style={[type.bodySmall, { textAlign: 'center', color: role.onSurfaceVariant }]}>Give this code to the seller only after you have checked the item. It releases your money to them.</Text>
                </View>
              ) : null}
              {d.status === 'shipped' ? <KV k="Tracking" v={`${d.courier || 'Courier'} · ${d.tracking_number || ''}`} /> : null}
              <Button title="I got the item. Release the money" icon="check-circle" onPress={() => post('confirm', 'confirm', {}, 'Thanks. Our team does a quick check, then the seller is paid.')} loading={act.busy === 'confirm'} />
              <Button title="Something is wrong" icon="exclamation-triangle" variant="danger" onPress={() => setSheet('dispute')} />
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <Notice tone="ok" icon="lock-closed" text={`${tk(d.amount_paisa)} is held safely. You can hand over the item now.`} />
              {d.handover === 'courier' ? (
                d.status === 'shipped' ? (
                  <KV k="Tracking" v={`${d.courier || 'Courier'} · ${d.tracking_number || ''}`} />
                ) : (
                  <Button title="I've shipped it" icon="truck" onPress={() => setSheet('ship')} />
                )
              ) : (
                <Button title="Enter the buyer's release code" icon="key" onPress={() => setSheet('code')} />
              )}
              <Button title="Report a problem" variant="ghost" icon="exclamation-triangle" onPress={() => setSheet('dispute')} />
            </View>
          )
        ) : null}

        {d.status === 'buyer_confirmed' || d.status === 'release_queued' ? (
          <Text style={type.bodyMedium}>{buyer ? 'You confirmed. ' : 'The buyer confirmed. '}Our team is doing a quick check before the money goes to the seller.</Text>
        ) : null}
        {d.status === 'refund_queued' || d.status === 'split_queued' ? <Text style={type.bodyMedium}>A decision was made on the dispute. Our team is processing the money now.</Text> : null}
        {d.status === 'cancelled' ? <Text style={type.bodyMedium}>This deal was cancelled. No money moved.</Text> : null}
        {DONE.includes(d.status) ? (
          <View style={{ gap: 8 }}>
            <Text style={type.bodyMedium}>
              {d.status === 'refunded' ? 'The buyer was refunded.' : d.status === 'split_done' ? 'The money was split between you.' : buyer ? 'Done. The seller has been paid.' : `Done. You get ${tk(d.seller_net_paisa)}.`}
            </Text>
            {!buyer && d.payout ? <KV k="Payout" v={`${titleCase(d.payout.status)} · ${tk(d.payout.amount_paisa)}`} /> : null}
            {!buyer && !d.payout && d.status !== 'refunded' ? (
              <Button title="Set up where you get paid" variant="ghost" icon="wallet" onPress={() => router.push('/wallet')} />
            ) : null}
            {['completed', 'refunded', 'split_done'].includes(d.status) && !d.my_review ? <ReviewBox dealId={d.id} name={other.display_name} onDone={set} /> : null}
            {d.my_review ? <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>You gave {d.my_review.stars} stars. Thanks.</Text> : null}
          </View>
        ) : null}

        {d.status === 'disputed' && d.dispute ? (
          <View style={{ gap: 10 }}>
            <Notice tone="warn" text={`Dispute opened: ${d.dispute.reason}. The money stays held while our team looks at the proof. A person makes the final decision.`} />
            {d.dispute.evidence?.length ? (
              <View style={{ gap: 6 }}>
                {d.dispute.evidence.map((e: { mine: boolean; note: string; created_at: string; media: string[] }, i: number) => (
                  <View key={i} style={{ padding: 10, borderRadius: radius.md, backgroundColor: role.surfaceContainerLow }}>
                    <Text style={type.labelMedium}>
                      {e.mine ? 'You' : other.display_name} · {dateTime(e.created_at)}
                    </Text>
                    {e.note ? <Text style={type.bodyMedium}>{e.note}</Text> : null}
                    {e.media?.length ? <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>{e.media.length} photo(s)</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
            <Button title="Add evidence" icon="photo" onPress={() => setSheet('evidence')} />
          </View>
        ) : null}
      </Card>

      {/* Safety tools during an active meetup deal */}
      {ACTIVE.includes(d.status) || d.status === 'accepted' || d.status === 'payment_pending' ? (
        <Card>
          <SectionTitle title="Stay safe" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {d.handover !== 'courier' ? <Chip icon="map-pin" label="Safe meeting spots" onPress={() => router.push('/safe-spots')} /> : null}
            {ACTIVE.includes(d.status) ? <Chip icon="camera" label="Save handover proof" onPress={() => setSheet('proof')} /> : null}
            <Chip icon="share" label={d.trip ? 'Trip link shared' : 'Share trip with a friend'} onPress={trip} />
            {d.contract?.url ? <Chip icon="document-check" label="Agreement PDF" onPress={() => Linking.openURL(api.url(d.contract!.url))} /> : null}
          </View>
          {d.trip ? (
            <Text selectable style={[type.bodySmall, { color: palette.link, marginTop: 8 }]}>
              {api.url(d.trip.url)}
            </Text>
          ) : null}
          {d.handover !== 'courier' && ACTIVE.includes(d.status) ? (
            <Pressable
              onPress={sos}
              accessibilityRole="button"
              accessibilityLabel="SOS: alert the Amanat team with your location"
              style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, borderRadius: radius.pill, backgroundColor: accent.red }}
            >
              <Icon name="shield-exclamation" size={22} color="#fff" />
              <Text style={[type.labelLarge, { color: '#fff', fontFamily: fonts.bold }]}>{act.busy === 'sos' ? 'Sending…' : 'SOS · I feel unsafe'}</Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      {/* Agreement */}
      {d.contract ? (
        <Card>
          <SectionTitle title="Agreement" />
          <KV k="Buyer signed" v={d.contract.buyer_signed_at ? dateTime(d.contract.buyer_signed_at) : 'Not yet'} />
          <KV k="Seller signed" v={d.contract.seller_signed_at ? dateTime(d.contract.seller_signed_at) : 'Not yet'} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            {!(buyer ? d.contract.buyer_signed_at : d.contract.seller_signed_at) ? (
              <Button title="Sign agreement" icon="pencil-square" small onPress={() => post('sign', 'sign', {}, 'You signed the agreement.')} loading={act.busy === 'sign'} style={{ flex: 1 }} />
            ) : null}
            {d.contract.url ? <Button title="Open PDF" variant="ghost" small icon="document-text" onPress={() => Linking.openURL(api.url(d.contract!.url))} style={{ flex: 1 }} /> : null}
          </View>
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="Money" />
        <KV k="Deal amount" v={tk(d.amount_paisa)} />
        <KV k={`Amanat fee (${d.fee_percent}%)`} v={`−${tk(d.fee_paisa)}`} />
        <KV k={`Guarantee fund (${d.guarantee_percent}%)`} v={`−${tk(d.guarantee_paisa)}`} />
        <KV k="Seller gets" v={tk(d.seller_net_paisa)} strong />
      </Card>

      <Card>
        <SectionTitle title={buyer ? 'Seller' : 'Buyer'} />
        <SellerLine user={other} />
        <Button title="Open chat" variant="ghost" small icon="chat-bubble-left-right" onPress={() => router.push(`/chat/${d.chat_id}`)} style={{ marginTop: 8 }} />
      </Card>

      <Card>
        <SectionTitle title="Timeline" />
        {d.events.map((e, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 10, paddingVertical: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: e.actor_kind === 'admin' ? accent.pink : e.actor_kind === 'system' ? accent.amber : role.primary }} />
            <View style={{ flex: 1 }}>
              <Text style={type.bodyMedium}>{e.note || titleCase(e.to_status)}</Text>
              <Text style={[type.labelSmall, { color: role.onSurfaceVariant }]}>
                {dateTime(e.created_at)} · {e.actor_kind === 'admin' ? 'Amanat team' : e.actor_kind === 'system' ? 'Automatic' : 'You or the other side'}
              </Text>
            </View>
          </View>
        ))}
        {d.proofs.length ? (
          <Text style={[type.bodySmall, { color: role.onSurfaceVariant, marginTop: 6 }]}>
            {d.proofs.length} handover proof(s) saved with photo, time and location.
          </Text>
        ) : null}
      </Card>

      <CodeSheet visible={sheet === 'code'} onClose={() => setSheet(null)} dealId={d.id} onDone={(r) => (set(r), setSheet(null), setNote('Code accepted. Our team does a quick check, then you are paid.'))} />
      <ShipSheet visible={sheet === 'ship'} onClose={() => setSheet(null)} dealId={d.id} onDone={(r) => (set(r), setSheet(null))} />
      <DisputeSheet visible={sheet === 'dispute'} onClose={() => setSheet(null)} dealId={d.id} onDone={(r) => (set(r), setSheet(null))} />
      <EvidenceSheet visible={sheet === 'evidence'} onClose={() => setSheet(null)} dealId={d.id} onDone={(r) => (set(r), setSheet(null))} />
      <ProofSheet visible={sheet === 'proof'} onClose={() => setSheet(null)} dealId={d.id} seller={!buyer} onDone={(r) => (set(r), setSheet(null), setNote('Handover proof saved.'))} />
    </Page>
  );
}

function Stepper({ idx }: { idx: number }) {
  return (
    <View style={{ flexDirection: 'row', marginTop: 14 }}>
      {STEPS.map((s, i) => {
        const done = i <= idx;
        return (
          <View key={s.key} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : i <= idx ? role.primary : role.outlineVariant }} />
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? role.primary : role.surfaceContainerHigh }}>
                <Icon name={s.icon} size={15} color={done ? '#fff' : role.onSurfaceVariant} strokeWidth={2} />
              </View>
              <View style={{ flex: 1, height: 2, backgroundColor: i === STEPS.length - 1 ? 'transparent' : i < idx ? role.primary : role.outlineVariant }} />
            </View>
            <Text style={[type.labelSmall, { color: done ? role.onSurface : role.onSurfaceVariant, textAlign: 'center' }]} numberOfLines={2}>
              {s.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

type Done = (r: { deal: Deal }) => void;

function CodeSheet({ visible, onClose, dealId, onDone }: { visible: boolean; onClose: () => void; dealId: string; onDone: Done }) {
  const { api } = useSession();
  const [code, setCode] = useState('');
  const act = useAction();
  return (
    <Sheet visible={visible} onClose={onClose} title="Enter the release code">
      <View style={{ gap: 12 }}>
        <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>Ask the buyer for their 4-digit code once they've checked the item. After 5 wrong tries the deal locks for our team to check.</Text>
        <Field label="4-digit code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} style={{ fontSize: 28, letterSpacing: 8, textAlign: 'center' }} />
        <ErrorText text={act.error} />
        <Button title="Release money" disabled={code.length !== 4} loading={act.busy === 'c'} onPress={() => act.run('c', async () => onDone(await api.post(`/api/deals/${dealId}/release-code`, { code })))} />
      </View>
    </Sheet>
  );
}

function ShipSheet({ visible, onClose, dealId, onDone }: { visible: boolean; onClose: () => void; dealId: string; onDone: Done }) {
  const { api } = useSession();
  const [courier, setCourier] = useState('Pathao');
  const [tn, setTn] = useState('');
  const act = useAction();
  return (
    <Sheet visible={visible} onClose={onClose} title="Mark as shipped">
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['Pathao', 'Steadfast', 'RedX', 'Sundarban'].map((c) => (
            <Chip key={c} label={c} selected={courier === c} onPress={() => setCourier(c)} />
          ))}
        </View>
        <Field label="Tracking number" value={tn} onChangeText={setTn} autoCapitalize="characters" />
        <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>Test mode: tracking is simulated. If the buyer doesn't respond after delivery, the money is released automatically after the waiting time.</Text>
        <ErrorText text={act.error} />
        <Button title="Save" loading={act.busy === 's'} onPress={() => act.run('s', async () => onDone(await api.post(`/api/deals/${dealId}/ship`, { courier, tracking_number: tn.trim() })))} />
      </View>
    </Sheet>
  );
}

const REASONS = ['Item not received', 'Item not as described', 'Item is fake or damaged', 'Seller or buyer stopped replying', 'Other'];

function DisputeSheet({ visible, onClose, dealId, onDone }: { visible: boolean; onClose: () => void; dealId: string; onDone: Done }) {
  const { api } = useSession();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const act = useAction();
  return (
    <Sheet visible={visible} onClose={onClose} title="Open a dispute">
      <View style={{ gap: 12 }}>
        <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>The money stays held. You and the other side can add proof, and an Amanat team member decides.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {REASONS.map((r) => (
            <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />
          ))}
        </View>
        <Field label="What happened?" value={details} onChangeText={setDetails} multiline style={{ minHeight: 90 }} />
        <ErrorText text={act.error} />
        <Button title="Open dispute" variant="danger" loading={act.busy === 'd'} onPress={() => act.run('d', async () => onDone(await api.post(`/api/deals/${dealId}/dispute`, { reason, details })))} />
      </View>
    </Sheet>
  );
}

function EvidenceSheet({ visible, onClose, dealId, onDone }: { visible: boolean; onClose: () => void; dealId: string; onDone: Done }) {
  const { api } = useSession();
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const act = useAction();
  const add = () =>
    act.run('p', async () => {
      const p = await pickPhoto('gallery');
      if (!p) return;
      const f = await upload(api, p, 'evidence');
      setPhotos((x) => [...x, f.id]);
    });
  return (
    <Sheet visible={visible} onClose={onClose} title="Add evidence">
      <View style={{ gap: 12 }}>
        <Field label="Note" value={note} onChangeText={setNote} multiline style={{ minHeight: 80 }} />
        <Button title={photos.length ? `${photos.length} photo(s) added. Add another` : 'Add a photo or screenshot'} variant="ghost" icon="photo" onPress={add} loading={act.busy === 'p'} />
        <ErrorText text={act.error} />
        <Button
          title="Send evidence"
          loading={act.busy === 'e'}
          onPress={() =>
            act.run('e', async () => {
              const r = await api.post<{ deal: Deal }>(`/api/deals/${dealId}/evidence`, { note, media: photos });
              setNote('');
              setPhotos([]);
              onDone(r);
            })
          }
        />
      </View>
    </Sheet>
  );
}

function ProofSheet({ visible, onClose, dealId, seller, onDone }: { visible: boolean; onClose: () => void; dealId: string; seller: boolean; onDone: Done }) {
  const { api } = useSession();
  const [selfie, setSelfie] = useState<string | null>(null);
  const [items, setItems] = useState<string[]>([]);
  const act = useAction();
  const shoot = (kind: 'selfie' | 'item') =>
    act.run(kind, async () => {
      const p = await pickPhoto('camera', { front: kind === 'selfie' });
      if (!p) return;
      const f = await upload(api, p, 'deal-proofs');
      if (kind === 'selfie') setSelfie(f.id);
      else setItems((x) => [...x, f.id]);
    });
  return (
    <Sheet visible={visible} onClose={onClose} title="Save handover proof">
      <View style={{ gap: 12 }}>
        <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>A selfie with the item, plus the time and your location, protects you if there's a dispute later. Only our team can see it.</Text>
        <Button title={selfie ? 'Selfie taken. Retake' : 'Take a selfie'} variant={selfie ? 'ghost' : 'primary'} icon="camera" onPress={() => shoot('selfie')} loading={act.busy === 'selfie'} />
        <Button title={items.length ? `${items.length} item photo(s). Add another` : 'Photo of the item (optional)'} variant="ghost" icon="photo" onPress={() => shoot('item')} loading={act.busy === 'item'} />
        <ErrorText text={act.error} />
        <Button
          title="Save proof with my location"
          icon="map-pin"
          disabled={!selfie}
          loading={act.busy === 'save'}
          onPress={() =>
            act.run('save', async () => {
              const fix = await getFix();
              const r = await api.post<{ deal: Deal }>(`/api/deals/${dealId}/proof`, { stage: 'handover', selfie, item_photos: items, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, is_mock: fix.is_mock });
              setSelfie(null);
              setItems([]);
              onDone(r);
            })
          }
        />
        {seller ? null : null}
      </View>
    </Sheet>
  );
}

function ReviewBox({ dealId, name, onDone }: { dealId: string; name: string; onDone: Done }) {
  const { api } = useSession();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const act = useAction();
  return (
    <View style={{ gap: 10, marginTop: 6, padding: 12, borderRadius: radius.md, backgroundColor: tint(accent.amber, 0.08) }}>
      <Text style={type.titleSmall}>How was {name}?</Text>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setStars(n)} accessibilityRole="button" accessibilityLabel={`${n} stars`} style={{ padding: 6 }}>
            <Icon name="star" size={30} color={n <= stars ? accent.amber : role.outlineVariant} strokeWidth={2} />
          </Pressable>
        ))}
      </View>
      <Field label="Comment (optional)" value={comment} onChangeText={setComment} />
      <ErrorText text={act.error} />
      <Button title="Send review" small disabled={!stars} loading={act.busy === 'r'} onPress={() => act.run('r', async () => onDone(await api.post(`/api/deals/${dealId}/review`, { stars, comment })))} />
    </View>
  );
}

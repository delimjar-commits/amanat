import { useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { KV, Notice } from '../components/bits';
import { Icon } from '../components/Icon';
import { Text } from '../components/Text';
import { Button, Card, ErrorText, Field, Page, SectionTitle, StatusPill } from '../components/ui';
import { tk } from '../lib/format';
import { useAction } from '../lib/hooks';
import { pickPhoto, upload, type Picked } from '../lib/media';
import { useSession } from '../lib/session';
import { kycLabel } from '../lib/status';
import { accent, radius, role, tint, type } from '../lib/theme';

type Shot = { id: string; uri: string } | null;

export default function Verify() {
  const { me, refreshMe, config } = useSession();
  const level = me?.user.kyc_level || 'none';
  const kyc = me?.kyc;
  const pending = kyc && ['pending', 'ai_checked'].includes(kyc.status);
  return (
    <Page gap={14}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={[type.titleMedium, { flex: 1 }]}>Your level</Text>
          <StatusPill s={kycLabel[level]} />
        </View>
        <KV k="Your deal limit now" v={tk(me?.deal_limit_paisa || 0)} strong />
        {config ? (
          <View style={{ marginTop: 6 }}>
            <KV k="Phone verified" v={tk(config.limits.basic)} />
            <KV k="NID verified" v={tk(config.limits.verified)} />
            <KV k="Business" v={tk(config.limits.business)} />
          </View>
        ) : null}
      </Card>

      <PhoneStep done={level !== 'none'} phone={me?.user.phone || null} onDone={refreshMe} />

      {level === 'basic' || level === 'none' ? (
        pending ? (
          <Notice text="Your NID and selfie are being checked by our team. This usually takes a few hours. You'll get a notification." icon="clock" />
        ) : (
          <>
            {kyc?.status === 'rejected' ? <Notice tone="bad" text={`Your last try was not approved${kyc.reject_reason ? `: ${kyc.reject_reason}` : ''}. You can try again.`} /> : null}
            <NidStep disabled={level === 'none'} onDone={refreshMe} />
          </>
        )
      ) : null}

      {level === 'verified' ? (pending ? <Notice text="Your business upgrade is being checked." icon="clock" /> : <BusinessStep onDone={refreshMe} />) : null}
      {level === 'business' ? <Notice tone="ok" text="You have the highest level. Thank you for verifying." /> : null}
      <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>Your NID photos and selfies are private. Only the Amanat team can see them, and only to check who you are.</Text>
    </Page>
  );
}

function PhoneStep({ done, phone, onDone }: { done: boolean; phone: string | null; onDone: () => Promise<void> }) {
  const { api } = useSession();
  const [p, setP] = useState(phone || '');
  const act = useAction();
  return (
    <Card>
      <SectionTitle title="1. Your phone" right={done ? <Icon name="check-circle" size={22} color={accent.green} /> : undefined} />
      {done ? (
        <Text style={type.bodyMedium}>{phone} is on your account.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          <Field label="Mobile number" placeholder="01712345678" value={p} onChangeText={setP} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
          <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>Test mode: no SMS code is sent yet.</Text>
          <ErrorText text={act.error} />
          <Button title="Save number" loading={act.busy === 'p'} onPress={() => act.run('p', async () => (await api.post('/api/me/phone', { phone: p }), await onDone()))} />
        </View>
      )}
    </Card>
  );
}

function NidStep({ disabled, onDone }: { disabled: boolean; onDone: () => Promise<void> }) {
  const { api } = useSession();
  const [nid, setNid] = useState('');
  const [name, setName] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [dob, setDob] = useState('');
  const [front, setFront] = useState<Shot>(null);
  const [back, setBack] = useState<Shot>(null);
  const [selfie, setSelfie] = useState<Shot>(null);
  const [turn, setTurn] = useState<Shot>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  const shoot = (key: string, from: 'camera' | 'gallery', setter: (s: Shot) => void, front = false) =>
    act.run(key, async () => {
      const p: Picked | null = await pickPhoto(from, { front });
      if (!p) return;
      const f = await upload(api, p, 'kyc-private');
      setter({ id: f.id, uri: p.uri });
    });
  const submit = () =>
    act.run('submit', async () => {
      const r = await api.post<{ message: string }>('/api/kyc', {
        nid_number: nid,
        full_name_en: name,
        full_name_bn: nameBn || undefined,
        date_of_birth: dob,
        nid_front: front?.id,
        nid_back: back?.id,
        selfie: selfie?.id,
        selfie_turn: turn?.id,
        liveness: { straight: Boolean(selfie), turned: Boolean(turn) },
      });
      setMsg(r.message);
      await onDone();
    });
  return (
    <Card>
      <SectionTitle title="2. NID and live selfie" />
      {disabled ? <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>Save your phone number first.</Text> : null}
      <View style={{ gap: 12, opacity: disabled ? 0.5 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
        <Field label="NID number" value={nid} onChangeText={(t) => setNid(t.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Field label="Name as on NID (English)" value={name} onChangeText={setName} autoCapitalize="characters" />
        <Field label="Name in Bangla (optional)" value={nameBn} onChangeText={setNameBn} />
        <Field label="Date of birth" placeholder="YYYY-MM-DD" value={dob} onChangeText={(t) => setDob(t.replace(/[^0-9-]/g, '').slice(0, 10))} keyboardType="numbers-and-punctuation" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <ShotBox label="NID front" shot={front} busy={act.busy === 'front'} onPress={() => shoot('front', 'camera', setFront)} />
          <ShotBox label="NID back" shot={back} busy={act.busy === 'back'} onPress={() => shoot('back', 'camera', setBack)} />
        </View>
        <Text style={type.labelLarge}>Live selfie</Text>
        <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>
          Take two quick selfies with the front camera: one looking straight, then one with your head turned to the left. This shows it's really you.
          {Platform.OS === 'web' ? ' In a browser, your phone may ask whether to use the camera.' : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <ShotBox label="Look straight" shot={selfie} busy={act.busy === 'selfie'} onPress={() => shoot('selfie', 'camera', setSelfie, true)} round />
          <ShotBox label="Turn left" shot={turn} busy={act.busy === 'turn'} onPress={() => shoot('turn', 'camera', setTurn, true)} round />
        </View>
        <ErrorText text={act.error} />
        {msg ? <Notice tone="ok" text={msg} /> : null}
        <Button title="Send for checking" disabled={!front || !back || !selfie} loading={act.busy === 'submit'} onPress={submit} />
      </View>
    </Card>
  );
}

function BusinessStep({ onDone }: { onDone: () => Promise<void> }) {
  const { api, me } = useSession();
  const [lic, setLic] = useState('');
  const [shop, setShop] = useState(me?.user.shop_name || '');
  const [photo, setPhoto] = useState<Shot>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  return (
    <Card>
      <SectionTitle title="Business badge (optional)" />
      <View style={{ gap: 12 }}>
        <Field label="Shop name" value={shop} onChangeText={setShop} />
        <Field label="Trade licence number" value={lic} onChangeText={setLic} />
        <ShotBox
          label="Trade licence photo"
          shot={photo}
          busy={act.busy === 'ph'}
          onPress={() =>
            act.run('ph', async () => {
              const p = await pickPhoto('gallery');
              if (!p) return;
              const f = await upload(api, p, 'kyc-private');
              setPhoto({ id: f.id, uri: p.uri });
            })
          }
        />
        <ErrorText text={act.error} />
        {msg ? <Notice tone="ok" text={msg} /> : null}
        <Button
          title="Apply for business badge"
          disabled={!photo}
          loading={act.busy === 'b'}
          onPress={() =>
            act.run('b', async () => {
              await api.post('/api/kyc/business', { trade_licence_no: lic, licence_photo: photo?.id, shop_name: shop });
              setMsg('Sent. Our team will check your licence.');
              await onDone();
            })
          }
        />
      </View>
    </Card>
  );
}

function ShotBox({ label, shot, onPress, busy, round }: { label: string; shot: Shot; onPress: () => void; busy?: boolean; round?: boolean }) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <View
        style={{ aspectRatio: round ? 1 : 1.5, borderRadius: round ? 999 : radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: shot ? accent.green : role.outline, backgroundColor: shot ? tint(accent.green, 0.06) : role.surfaceContainerLow, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
      >
        {shot ? <Image source={{ uri: shot.uri }} style={{ width: '100%', height: '100%' }} /> : <Icon name="camera" size={26} color={role.onSurfaceVariant} />}
      </View>
      <Button title={busy ? 'Uploading…' : shot ? `Retake ${label.toLowerCase()}` : label} small variant={shot ? 'ghost' : 'primary'} onPress={onPress} loading={busy} />
    </View>
  );
}

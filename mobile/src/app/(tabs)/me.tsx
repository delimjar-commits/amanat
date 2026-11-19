import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Badges, KycPill, Notice, TrustPill, UserAvatar } from '../../components/bits';
import { Icon, type HeroName } from '../../components/Icon';
import { Text } from '../../components/Text';
import { Button, Card, ErrorText, Page } from '../../components/ui';
import { tk } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { accent, radius, role, type } from '../../lib/theme';

function Row({ icon, label, sub, onPress, color }: { icon: HeroName; label: string; sub?: string; onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: pressed ? role.surfaceContainerHigh : 'transparent' })}
    >
      <Icon name={icon} size={22} color={color || role.onSurface} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.bodyLarge, { color: color || role.onSurface }]}>{label}</Text>
        {sub ? (
          <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-right" size={18} color={role.onSurfaceVariant} />
    </Pressable>
  );
}

export default function Me() {
  const { me, signOut, api } = useSession();
  const act = useAction();
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!me) return null;
  const u = me.user;
  const unread = me.unread_notifications;
  return (
    <Page inTabs gap={14}>
      <Card>
        <Pressable onPress={() => router.push('/edit-profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }} accessibilityRole="button" accessibilityLabel="Edit profile">
          <UserAvatar user={u} size={64} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={type.titleLarge} numberOfLines={1}>
              {u.shop_name || u.display_name}
            </Text>
            <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]} numberOfLines={1}>
              {u.email}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <KycPill level={u.kyc_level} />
              <TrustPill score={u.trust_score} />
            </View>
          </View>
          <Icon name="pencil" size={18} color={role.onSurfaceVariant} />
        </Pressable>
        {u.badges?.length ? (
          <View style={{ marginTop: 10 }}>
            <Badges list={u.badges} />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <View style={{ flex: 1, padding: 10, borderRadius: radius.md, backgroundColor: role.surfaceContainerLow }}>
            <Text style={[type.labelSmall, { color: role.onSurfaceVariant }]}>Deal limit</Text>
            <Text style={type.titleMedium}>{tk(me.deal_limit_paisa)}</Text>
          </View>
          <View style={{ flex: 1, padding: 10, borderRadius: radius.md, backgroundColor: role.surfaceContainerLow }}>
            <Text style={[type.labelSmall, { color: role.onSurfaceVariant }]}>Deals done</Text>
            <Text style={type.titleMedium}>{u.deals_completed}</Text>
          </View>
        </View>
      </Card>

      {u.kyc_level !== 'verified' && u.kyc_level !== 'business' ? (
        <Notice tone="warn" text={u.kyc_level === 'none' ? 'Verify your phone to start buying and selling.' : 'Verify your NID to raise your limit and get paid.'}>
          <Button title="Verify now" small onPress={() => router.push('/verify')} />
        </Notice>
      ) : null}

      <Card style={{ paddingHorizontal: 4, paddingVertical: 4 }}>
        <Row icon="bell" label="Notifications" sub={unread ? `${unread} new` : undefined} onPress={() => router.push('/notifications')} />
        <Row icon="wallet" label="Wallet and payouts" sub="Money held, waiting and paid out" onPress={() => router.push('/wallet')} />
        <Row icon="tag" label="My listings" onPress={() => router.push('/my-listings')} />
        <Row icon="heart" label="Saved" onPress={() => router.push('/saved')} />
        <Row icon="megaphone" label="Wanted posts" onPress={() => router.push('/wanted')} />
        <Row icon="identification" label="Verification" sub="Phone, NID and business badge" onPress={() => router.push('/verify')} />
        <Row icon="shield-check" label="Your trust score" sub={`${u.trust_score} out of 100`} onPress={() => router.push('/trust')} />
      </Card>

      <Card style={{ paddingHorizontal: 4, paddingVertical: 4 }}>
        <Row icon="map-pin" label="Safe meeting spots" onPress={() => router.push('/safe-spots')} />
        <Row icon="lifebuoy" label="Help" sub="Ask the helper or reach our team" onPress={() => router.push('/support')} />
        <Row icon="gift" label="Invite friends" sub={`Your code: ${u.referral_code}`} onPress={() => setNote(`Share your code ${u.referral_code}. Friends enter it when they create an account.`)} />
      </Card>
      {note ? <Notice tone="ok" text={note} /> : null}

      <Card style={{ paddingHorizontal: 4, paddingVertical: 4 }}>
        <Row icon="arrow-right-on-rectangle" label="Sign out" onPress={signOut} />
        <Row icon="trash" label="Delete my account" color={accent.red} onPress={() => setConfirmDelete(true)} />
      </Card>
      {confirmDelete ? (
        <Notice tone="bad" text="Your listings are removed now and your account is deleted after 7 days. Deal and payment records the law requires are kept with your name removed.">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              title="Delete account"
              variant="danger"
              small
              loading={act.busy === 'del'}
              onPress={() =>
                act.run('del', async () => {
                  await api.post('/api/me/delete');
                  await signOut();
                })
              }
            />
            <Button title="Keep it" variant="ghost" small onPress={() => setConfirmDelete(false)} />
          </View>
          <ErrorText text={act.error} />
        </Notice>
      ) : null}
      <Text style={[type.labelSmall, { color: role.onSurfaceVariant, textAlign: 'center' }]}>Amanat · test mode, no real money</Text>
    </Page>
  );
}

import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Badges, KycPill, Loader, Notice, TrustPill, UserAvatar } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { Button, Card, Empty, ErrorText, Page, SectionTitle } from '../../components/ui';
import { timeAgo } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { accent, role, type } from '../../lib/theme';
import type { Row } from '../../lib/types';

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, me } = useSession();
  const { data, error, loading, reload } = useLoad(() => api.get<Row>(`/api/users/${id}`), [id]);
  const act = useAction();
  const [note, setNote] = useState<string | null>(null);
  if (loading && !data) return <Loader />;
  if (!data)
    return (
      <Page>
        <ErrorText text={error || 'User not found.'} />
      </Page>
    );
  const u = data.user;
  const self = u.id === me?.user.id;
  return (
    <Page gap={14}>
      <Stack.Screen options={{ title: u.shop_name || u.display_name }} />
      <Card>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <UserAvatar user={u} size={84} />
          <Text style={[type.titleLarge, { textAlign: 'center' }]}>{u.shop_name || u.display_name}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <KycPill level={u.kyc_level} />
            <TrustPill score={u.trust_score} />
          </View>
          <Text style={[type.bodySmall, { color: role.onSurfaceVariant, textAlign: 'center' }]}>
            {u.deals_completed} deals done{u.area ? ` · ${u.area}` : ''} · joined {timeAgo(u.created_at)}
            {data.vouches ? ` · vouched by ${data.vouches}` : ''}
          </Text>
          {u.bio ? <Text style={[type.bodyMedium, { textAlign: 'center' }]}>{u.bio}</Text> : null}
          <Badges list={u.badges} />
        </View>
      </Card>
      {u.is_banned ? <Notice tone="bad" text="This account is blocked. Don't deal with it." /> : null}
      {note ? <Notice tone="ok" text={note} /> : null}
      <ErrorText text={act.error} />
      {!self ? (
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {!data.i_vouched ? (
            <Button
              title="Vouch for them"
              icon="hand-raised"
              variant="ghost"
              small
              loading={act.busy === 'v'}
              onPress={() =>
                act.run('v', async () => {
                  await api.post(`/api/users/${u.id}/vouch`, {});
                  setNote('Thanks for vouching.');
                  reload();
                })
              }
            />
          ) : null}
          <Button
            title="Report"
            icon="flag"
            variant="ghost"
            small
            loading={act.busy === 'r'}
            onPress={() =>
              act.run('r', async () => {
                await api.post('/api/reports', { user_id: u.id, reason: 'Suspicious account reported from profile' });
                setNote('Reported. Our team will look at it.');
              })
            }
          />
          <Button
            title="Block"
            icon="no-symbol"
            variant="ghost"
            small
            loading={act.busy === 'b'}
            onPress={() =>
              act.run('b', async () => {
                await api.post(`/api/users/${u.id}/block`, {});
                setNote("Blocked. They can't message you.");
              })
            }
          />
        </View>
      ) : null}
      <Card>
        <SectionTitle title={data.rating?.n ? `Reviews · ${Number(data.rating.avg).toFixed(1)} from ${data.rating.n}` : 'Reviews'} />
        {data.reviews?.length ? (
          (data.reviews as Row[]).map((r, i) => (
            <View key={i} style={{ paddingVertical: 8, gap: 2, borderTopWidth: i ? 1 : 0, borderTopColor: role.outlineVariant }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Icon key={n} name="star" size={14} color={n <= r.stars ? accent.amber : role.outlineVariant} strokeWidth={2} />
                ))}
                <Text style={[type.labelSmall, { color: role.onSurfaceVariant, marginLeft: 6 }]}>
                  {r.reviewer} · {timeAgo(r.created_at)}
                </Text>
              </View>
              {r.comment ? <Text style={type.bodyMedium}>{r.comment}</Text> : null}
            </View>
          ))
        ) : (
          <Empty icon="star" title="No reviews yet" />
        )}
      </Card>
    </Page>
  );
}

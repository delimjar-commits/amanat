import { router } from 'expo-router';
import { RefreshControl, View } from 'react-native';
import { Bars, ListRow, useAdmin, roleLabel } from '../../../components/admin';
import { Loader, Notice, Stat } from '../../../components/bits';
import { Text } from '../../../components/Text';
import { Card, ErrorText, Page, SectionTitle, Tag, useLayout } from '../../../components/ui';
import { timeAgo, tk } from '../../../lib/format';
import { useLoad } from '../../../lib/hooks';
import { actionLabel } from '../../../lib/status';
import { accent, role, type } from '../../../lib/theme';
import type { Row } from '../../../lib/types';

export default function Dashboard() {
  const { api, admin } = useAdmin();
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.get<Row>('/api/admin/dashboard'), [], { pollMs: 30000 });
  const { wide } = useLayout();
  if (loading && !data) return <Loader />;
  const s = data?.stats || {};
  const w: `${number}%` = wide ? '23%' : '47%';
  return (
    <Page inTabs refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} gap={16}>
      <View style={{ gap: 4 }}>
        <Text style={[type.titleLarge, { color: role.onBackground }]}>Hi {admin?.name?.split(' ')[0] || 'there'}</Text>
        <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>{roleLabel[admin?.role || ''] || admin?.role} · nothing moves money without a person approving it.</Text>
      </View>
      <ErrorText text={error} />
      {data && !data.ai?.enabled ? <Notice tone="warn" text="The AI is off. Add your OmniRoute key in More › Settings to get AI recommendations." /> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Stat width={w} label="Waiting for you" value={s.pending_actions ?? 0} icon="clipboard-document-check" color={s.pending_actions ? accent.amber : accent.green} onPress={() => router.push('/admin/queue')} />
        <Stat width={w} label="Open disputes" value={s.open_disputes ?? 0} icon="scale" color={s.open_disputes ? accent.red : accent.green} onPress={() => router.push('/admin/disputes')} />
        <Stat width={w} label="Alerts" value={s.open_alerts ?? 0} icon="bell-alert" color={s.open_alerts ? accent.red : accent.green} onPress={() => router.push('/admin/alerts')} />
        <Stat width={w} label="Help tickets" value={s.open_tickets ?? 0} icon="lifebuoy" onPress={() => router.push('/admin/support')} />
        <Stat width={w} label="Money held" value={tk(s.escrow_held_paisa)} icon="lock-closed" />
        <Stat width={w} label="Owed to sellers" value={tk(s.payouts_owed_paisa)} icon="banknotes" />
        <Stat width={w} label="Fees earned" value={tk(s.fees_earned_paisa)} icon="receipt-percent" color={accent.green} />
        <Stat width={w} label="Guarantee fund" value={tk(s.guarantee_fund_paisa)} icon="shield-check" color={accent.green} />
        <Stat width={w} label="Users" value={`${s.users ?? 0} (+${s.new_users_24h ?? 0})`} icon="users" onPress={() => router.push('/admin/users')} />
        <Stat width={w} label="Verified" value={s.verified_users ?? 0} icon="identification" />
        <Stat width={w} label="Open deals" value={s.open_deals ?? 0} icon="shield-check" />
        <Stat width={w} label="Completed" value={s.completed_deals ?? 0} icon="check-circle" color={accent.green} />
      </View>

      <Card>
        <SectionTitle title="Deal money, last 14 days" />
        <Bars data={data?.volume || []} />
      </Card>

      {(data?.pending_by_type || []).length ? (
        <View style={{ gap: 8 }}>
          <SectionTitle title="Waiting by type" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {data!.pending_by_type.map((p: Row) => (
              <Tag key={p.type} text={`${actionLabel[p.type] || p.type}: ${p.n}`} color={accent.sky} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionTitle title="Latest alerts" right={<Text style={[type.labelLarge, { color: role.primary }]} onPress={() => router.push('/admin/alerts')}>All</Text>} />
        {(data?.alerts || []).length ? (
          data!.alerts.map((a: Row) => <ListRow key={a.id} icon="bell-alert" color={a.priority <= 1 ? accent.red : accent.amber} title={a.title} sub={[a.body, timeAgo(a.created_at)].filter(Boolean).join(' · ')} onPress={() => router.push('/admin/alerts')} />)
        ) : (
          <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>No open alerts.</Text>
        )}
      </View>
      <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>AI: {data?.ai?.enabled ? `on${data.ai.last?.at ? `, last call ${timeAgo(data.ai.last.at)}${data.ai.last.ok === false ? ' (failed)' : ''}` : ''}` : 'off'}</Text>
    </Page>
  );
}

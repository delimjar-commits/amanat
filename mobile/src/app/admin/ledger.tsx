import { RefreshControl, View } from 'react-native';
import { Small, useAdmin } from '../../components/admin';
import { KV, Loader, Notice } from '../../components/bits';
import { Text } from '../../components/Text';
import { Card, ErrorText, Page, SectionTitle } from '../../components/ui';
import { dateTime, titleCase, tk } from '../../lib/format';
import { useLoad } from '../../lib/hooks';
import { accent, role, type } from '../../lib/theme';
import type { Row } from '../../lib/types';

export default function Ledger() {
  const { api } = useAdmin();
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.get<Row>('/api/admin/ledger'));
  if (loading && !data) return <Loader />;
  const v = data?.verify || {};
  const ok = Boolean(v.ok);
  return (
    <Page refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} gap={12}>
      <ErrorText text={error} />
      {data ? <Notice tone={ok ? 'ok' : 'bad'} text={ok ? `Tamper check passed on ${v.entries ?? 0} entries, and every transaction balances. Each entry links to the one before it, and none can be edited or deleted.` : `Tamper check FAILED.${v.broken_id ? ` The chain breaks at entry #${v.broken_id}.` : ''}${Number(v.unbalanced_txns) ? ` ${v.unbalanced_txns} transactions don't balance.` : ''}`} /> : null}
      <Card>
        <SectionTitle title="Balances" />
        {(data?.balances || []).map((b: Row) => (
          <KV key={b.account} k={titleCase(b.account)} v={tk(b.balance)} strong />
        ))}
      </Card>
      <SectionTitle title="Latest entries" />
      {(data?.entries || []).map((e: Row) => (
        <View key={e.id} style={{ flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: role.outlineVariant }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.bodyMedium, { color: role.onSurface }]} numberOfLines={2}>
              {titleCase(e.account)} · {e.memo}
            </Text>
            <Small>
              #{e.id} · {dateTime(e.created_at)} · {e.hash}
            </Small>
          </View>
          <Text style={[type.titleSmall, { color: Number(e.debit_paisa) ? accent.green : accent.red }]}>{Number(e.debit_paisa) ? `+${tk(e.debit_paisa)}` : `−${tk(e.credit_paisa)}`}</Text>
        </View>
      ))}
    </Page>
  );
}

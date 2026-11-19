import { router } from 'expo-router';
import { RefreshControl } from 'react-native';
import { ListRow, useAdmin } from '../../../components/admin';
import { Loader } from '../../../components/bits';
import { Empty, ErrorText, Page, StatusPill, Tag } from '../../../components/ui';
import { timeAgo, titleCase, tk } from '../../../lib/format';
import { useLoad } from '../../../lib/hooks';
import { accent } from '../../../lib/theme';
import type { Row } from '../../../lib/types';

export default function Disputes() {
  const { api } = useAdmin();
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.get<{ disputes: Row[] }>('/api/admin/disputes'), [], { pollMs: 30000 });
  if (loading && !data) return <Loader />;
  const list = data?.disputes || [];
  return (
    <Page inTabs refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} gap={10}>
      <ErrorText text={error} />
      {list.length ? (
        list.map((d) => (
          <ListRow
            key={d.id}
            icon="scale"
            color={d.status === 'resolved' ? accent.green : accent.red}
            title={`${d.title} · ${tk(d.amount_paisa)}`}
            sub={`${d.buyer} (buyer) vs ${d.seller} (seller) · ${titleCase(d.reason || '')} · opened ${timeAgo(d.created_at)}`}
            onPress={() => router.push(`/admin/deal/${d.deal_id}`)}
            badge={
              <>
                <Tag text={titleCase(d.status)} color={d.status === 'resolved' ? accent.green : accent.red} />
                <StatusPill status={d.deal_status} />
                <Tag text={`${d.evidence_count} evidence`} color={accent.sky} />
              </>
            }
          />
        ))
      ) : (
        <Empty icon="scale" title="No disputes" body="When a buyer or seller opens a dispute it shows here." />
      )}
    </Page>
  );
}

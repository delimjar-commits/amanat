import { RefreshControl } from 'react-native';
import { Grid, ListingCard, Loader } from '../components/bits';
import { Empty, ErrorText, Page, useLayout } from '../components/ui';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { Listing } from '../lib/types';

export default function Saved() {
  const { api } = useSession();
  const { width, gutter } = useLayout();
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.get<{ listings: Listing[] }>('/api/saved'), []);
  return (
    <Page gap={12} maxWidth={1080} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <ErrorText text={error} />
      {loading && !data ? (
        <Loader />
      ) : data?.listings.length ? (
        <Grid items={data.listings} width={Math.min(width, 1080 + gutter * 2) - gutter * 2} min={160} render={(l, w) => <ListingCard key={l.id} l={l} width={w} />} />
      ) : (
        <Empty icon="heart" title="Nothing saved" body="Tap Save on a listing to keep it here." />
      )}
    </Page>
  );
}

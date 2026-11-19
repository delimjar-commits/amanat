import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { Loader, Notice, Segmented, UserAvatar } from '../components/bits';
import { Text } from '../components/Text';
import { Button, Card, Empty, ErrorText, Field, Page } from '../components/ui';
import { timeAgo, tk } from '../lib/format';
import { useAction, useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { role, type } from '../lib/theme';
import type { Row } from '../lib/types';

export default function Wanted() {
  const { api } = useSession();
  const [tab, setTab] = useState<'all' | 'new'>('all');
  const { data, error, loading, refreshing, refresh, reload } = useLoad(() => api.get<{ wanted: Row[] }>('/api/wanted'), []);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [max, setMax] = useState('');
  const [area, setArea] = useState('');
  const [ok, setOk] = useState(false);
  const act = useAction();
  return (
    <Page gap={12} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'all', label: 'What people want' },
          { value: 'new', label: 'Post a Wanted ad' },
        ]}
      />
      {tab === 'new' ? (
        <Card>
          <View style={{ gap: 12 }}>
            <Field label="What are you looking for?" value={title} onChangeText={setTitle} />
            <Field label="Details (optional)" value={details} onChangeText={setDetails} multiline style={{ minHeight: 80 }} />
            <Field label="Most you'll pay (taka, optional)" value={max} onChangeText={(t) => setMax(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" />
            <Field label="Area (optional)" value={area} onChangeText={setArea} />
            <ErrorText text={act.error} />
            {ok ? <Notice tone="ok" text="Posted. Sellers can now message you." /> : null}
            <Button
              title="Post"
              loading={act.busy === 'p'}
              onPress={() =>
                act.run('p', async () => {
                  await api.post('/api/wanted', { title, details, max_price: max ? Number(max) : undefined, area });
                  setTitle('');
                  setDetails('');
                  setMax('');
                  setOk(true);
                  reload();
                  setTab('all');
                })
              }
            />
          </View>
        </Card>
      ) : (
        <>
          <ErrorText text={error} />
          {loading && !data ? (
            <Loader />
          ) : !data?.wanted.length ? (
            <Empty icon="megaphone" title="No Wanted ads yet" body="Post what you're looking for and sellers can reach you." />
          ) : (
            data.wanted.map((w) => (
              <Card key={w.id}>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <UserAvatar user={w.user || { display_name: w.user_name }} size={40} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={type.titleSmall}>{w.title}</Text>
                    {w.details ? <Text style={type.bodyMedium}>{w.details}</Text> : null}
                    <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>
                      {[w.max_price_paisa ? `Up to ${tk(w.max_price_paisa)}` : null, w.area, timeAgo(w.created_at)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
              </Card>
            ))
          )}
        </>
      )}
    </Page>
  );
}

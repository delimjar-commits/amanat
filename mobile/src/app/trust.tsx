import { View } from 'react-native';
import { KV, Loader, trustColor } from '../components/bits';
import { Text } from '../components/Text';
import { Card, ErrorText, Page, SectionTitle } from '../components/ui';
import { dateTime } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { accent, fonts, role, type } from '../lib/theme';
import type { Row } from '../lib/types';

export default function Trust() {
  const { api, me } = useSession();
  const { data, error, loading } = useLoad(() => api.get<Row>('/api/me/trust'), []);
  const score = data?.score ?? me?.user.trust_score ?? 0;
  if (loading && !data) return <Loader />;
  const parts: Row = data?.breakdown || data?.parts || {};
  return (
    <Page gap={14}>
      <ErrorText text={error} />
      <Card>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 64, lineHeight: 72, color: trustColor(score) }}>{score}</Text>
          <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>out of 100</Text>
        </View>
      </Card>
      {Object.keys(parts).length ? (
        <Card>
          <SectionTitle title="What counts" />
          {Object.entries(parts).map(([k, v]) => (
            <KV key={k} k={k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())} v={typeof v === 'number' ? (v > 0 ? `+${v}` : String(v)) : String(v)} />
          ))}
        </Card>
      ) : null}
      <Card>
        <SectionTitle title="How to raise it" />
        {['Verify your phone and NID', 'Finish deals without disputes', 'Get good reviews', 'Get vouched for by trusted users', 'Reply quickly in chats'].map((t) => (
          <View key={t} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent.sky, marginTop: 8 }} />
            <Text style={[type.bodyMedium, { flex: 1 }]}>{t}</Text>
          </View>
        ))}
      </Card>
      {(data?.history || []).length ? (
        <Card>
          <SectionTitle title="History" />
          {(data!.history as Row[]).map((h, i) => (
            <KV key={i} k={dateTime(h.created_at)} v={String(h.score)} />
          ))}
        </Card>
      ) : null}
    </Page>
  );
}

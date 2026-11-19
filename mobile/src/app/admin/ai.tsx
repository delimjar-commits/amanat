import { useState } from 'react';
import { View } from 'react-native';
import { AiReviewCard, useAdmin } from '../../components/admin';
import { Text } from '../../components/Text';
import { Button, Card, Chip, ErrorText, Field, Page, SectionTitle } from '../../components/ui';
import { useAction } from '../../lib/hooks';
import { role, type } from '../../lib/theme';
import type { Row } from '../../lib/types';

const IDEAS = ['What should I look at first?', 'Any deals that look risky?', 'Summarise the open disputes', 'How did today go?'];

export default function AiHelper() {
  const { api } = useAdmin();
  const [q, setQ] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string }[]>([]);
  const [report, setReport] = useState<Row | null>(null);
  const act = useAction();
  const ask = (question: string) =>
    act.run('ask', async () => {
      const r = await api.post<{ answer: string }>('/api/admin/ai/copilot', { question });
      setChat((c) => [...c, { q: question, a: r.answer }]);
      setQ('');
    });
  return (
    <Page gap={12}>
      <Card style={{ gap: 6 }}>
        <SectionTitle title="Ask the AI" />
        <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>It reads the queue, disputes, alerts and recent deals. It can't approve anything.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {IDEAS.map((i) => (
            <Chip key={i} label={i} onPress={() => ask(i)} />
          ))}
        </View>
        <Field label="Your question" value={q} onChangeText={setQ} returnKeyType="send" onSubmitEditing={() => q.trim() && ask(q.trim())} maxLength={800} />
        <ErrorText text={act.error} />
        <Button title="Ask" icon="sparkles" variant="agent" onPress={() => ask(q.trim())} loading={act.busy === 'ask'} disabled={!q.trim()} />
      </Card>
      {chat
        .slice()
        .reverse()
        .map((c, i) => (
          <Card key={i}>
            <Text style={[type.titleSmall, { color: role.primary }]}>{c.q}</Text>
            <Text style={[type.bodyMedium, { color: role.onSurface, marginTop: 6 }]}>{c.a}</Text>
          </Card>
        ))}
      <Card style={{ gap: 6 }}>
        <SectionTitle title="Fraud report" />
        <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>The AI looks over the last day of deals, alerts and shared devices. It also runs on its own every day.</Text>
        <Button small variant="ghost" icon="shield-exclamation" title="Run it now" onPress={() => act.run('fraud', async () => setReport((await api.post<{ review: Row }>('/api/admin/ai/fraud-report')).review))} loading={act.busy === 'fraud'} />
      </Card>
      <AiReviewCard review={report} />
    </Page>
  );
}

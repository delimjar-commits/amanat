import { router } from 'expo-router';
import { View } from 'react-native';
import { roleLabel, useAdmin } from '../../../components/admin';
import { Text } from '../../../components/Text';
import { Card, Page, SectionTitle, SettingRow } from '../../../components/ui';
import { accent, role, type } from '../../../lib/theme';

export default function More() {
  const { admin, signOut, isSuper } = useAdmin();
  const can = (r: string[]) => isSuper || r.includes(admin?.role || '');
  return (
    <Page inTabs gap={14}>
      <Card>
        <Text style={[type.titleMedium, { color: role.onSurface }]}>{admin?.name}</Text>
        <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>
          {admin?.email} · {roleLabel[admin?.role || ''] || admin?.role}
        </Text>
      </Card>
      <View style={{ gap: 2 }}>
        <SectionTitle title="Watch" />
        <SettingRow icon="sparkles" color={accent.pink} title="AI helper" sub="Ask about the queue, disputes or today's numbers. Daily fraud report." onPress={() => router.push('/admin/ai')} />
        <SettingRow icon="bell-alert" color={accent.red} title="Alerts" sub="Fake GPS, shared devices, failed jobs" onPress={() => router.push('/admin/alerts')} />
        <SettingRow icon="flag" color={accent.amber} title="Reports" sub="What users reported" onPress={() => router.push('/admin/reports')} />
        <SettingRow icon="lifebuoy" title="Help tickets" sub="Reply to users who asked for a person" onPress={() => router.push('/admin/support')} />
      </View>
      <View style={{ gap: 2 }}>
        <SectionTitle title="Money and records" />
        {can(['finance']) ? <SettingRow icon="building-library" color={accent.green} title="Ledger" sub="Every taka in and out, with the tamper check" onPress={() => router.push('/admin/ledger')} /> : null}
        {isSuper ? <SettingRow icon="document-text" title="Audit log" sub="Who did what, and when" onPress={() => router.push('/admin/audit')} /> : null}
        <SettingRow icon="cog-6-tooth" title="Settings" sub={isSuper ? 'Fees, limits, AI key, safe spots, jobs' : 'View settings and safe spots'} onPress={() => router.push('/admin/settings')} />
      </View>
      <SettingRow
        icon="arrow-right-start-on-rectangle"
        danger
        title="Sign out of admin"
        onPress={async () => {
          await signOut();
          router.replace('/admin/sign-in');
        }}
      />
    </Page>
  );
}

import { router, Stack } from 'expo-router';
import { AppHeader } from '../../components/ui';
import { useSession } from '../../lib/session';
import { role } from '../../lib/theme';

// The admin app: its own sign-in (password, then an authenticator code), then the console.
export default function AdminLayout() {
  const { adminToken } = useSession();
  const signedIn = Boolean(adminToken);
  return (
    <Stack
      screenOptions={{
        header: ({ options, back, navigation }) => (
          <AppHeader
            title={typeof options.title === 'string' ? options.title : ''}
            onBack={back ? () => (navigation.canGoBack() ? navigation.goBack() : router.replace('/admin')) : () => router.replace('/admin')}
            right={options.headerRight ? options.headerRight({ canGoBack: Boolean(back), tintColor: role.onSurface }) : undefined}
          />
        ),
        contentStyle: { backgroundColor: role.background },
      }}
    >
      <Stack.Protected guard={!signedIn} redirectTo="/admin">
        <Stack.Screen name="sign-in" options={{ headerShown: false, title: 'Staff sign-in' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn} redirectTo="/admin/sign-in">
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="action/[id]" options={{ title: 'Review' }} />
        <Stack.Screen name="deal/[id]" options={{ title: 'Deal' }} />
        <Stack.Screen name="user/[id]" options={{ title: 'User' }} />
        <Stack.Screen name="alerts" options={{ title: 'Alerts' }} />
        <Stack.Screen name="reports" options={{ title: 'Reports' }} />
        <Stack.Screen name="ledger" options={{ title: 'Ledger' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="audit" options={{ title: 'Audit log' }} />
        <Stack.Screen name="ai" options={{ title: 'AI helper' }} />
        <Stack.Screen name="support" options={{ title: 'Support' }} />
      </Stack.Protected>
    </Stack>
  );
}

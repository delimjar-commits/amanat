import { Anton_400Regular } from '@expo-google-fonts/anton';
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, DMSans_800ExtraBold, DMSans_900Black } from '@expo-google-fonts/dm-sans';
import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WakeBanner, WakeScreen } from '../components/ServerWake';
import { AppHeader } from '../components/ui';
import { SessionProvider, useSession } from '../lib/session';
import { role } from '../lib/theme';

void SystemUI.setBackgroundColorAsync(role.background).catch(() => {});

function Loading() {
  return (
    <View style={{ flex: 1, backgroundColor: role.background, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={role.primary} />
    </View>
  );
}

function RootStack() {
  const { ready, token, server } = useSession();
  if (!ready) return server === 'waking' || server === 'down' ? <WakeScreen /> : <Loading />;
  const signedIn = Boolean(token);
  return (
    <View style={{ flex: 1, backgroundColor: role.background }}>
      <WakeBanner />
      <Stack
        screenOptions={{
          header: ({ options, back, navigation }) => (
            <AppHeader
              title={typeof options.title === 'string' ? options.title : ''}
              modal={options.presentation === 'modal'}
              onBack={back ? () => (navigation.canGoBack() ? navigation.goBack() : router.replace('/')) : () => router.replace('/')}
              right={options.headerRight ? options.headerRight({ canGoBack: Boolean(back), tintColor: role.onSurface }) : undefined}
            />
          ),
          contentStyle: { backgroundColor: role.background },
        }}
      >
        {/* The admin app has its own sign-in (password + authenticator code). */}
        <Stack.Screen name="admin" options={{ headerShown: false }} />
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="listing/[id]" options={{ title: 'Listing' }} />
          <Stack.Screen name="deal/[id]" options={{ title: 'Deal' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
          <Stack.Screen name="user/[id]" options={{ title: 'Profile' }} />
          <Stack.Screen name="verify" options={{ title: 'Verify your account' }} />
          <Stack.Screen name="wallet" options={{ title: 'Wallet and payouts' }} />
          <Stack.Screen name="saved" options={{ title: 'Saved' }} />
          <Stack.Screen name="wanted" options={{ title: 'Wanted posts' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="safe-spots" options={{ title: 'Safe meeting spots' }} />
          <Stack.Screen name="support" options={{ title: 'Help' }} />
          <Stack.Screen name="trust" options={{ title: 'Your trust score' }} />
          <Stack.Screen name="edit-profile" options={{ title: 'Edit profile' }} />
          <Stack.Screen name="my-listings" options={{ title: 'My listings' }} />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, DMSans_800ExtraBold, DMSans_900Black, Anton_400Regular });
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {fontsLoaded ? (
        <SessionProvider>
          <RootStack />
        </SessionProvider>
      ) : (
        <Loading />
      )}
    </SafeAreaProvider>
  );
}

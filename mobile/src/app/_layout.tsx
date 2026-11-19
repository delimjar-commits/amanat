import { Anton_400Regular } from '@expo-google-fonts/anton';
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, DMSans_800ExtraBold, DMSans_900Black } from '@expo-google-fonts/dm-sans';
import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
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
        {/* Each guard says where to send people. Without redirectTo, Expo Router falls back to the first open
            route in file order, which is "admin", so everyone signed out landed on the staff sign-in. */}
        <Stack.Protected guard={!signedIn} redirectTo="/">
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn} redirectTo="/welcome">
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
        {/* The admin app has its own sign-in (password + authenticator code). Only reached through /admin
            or the "Staff sign-in" link, never as a fallback. */}
        <Stack.Screen name="admin" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

// Web: when the phone keyboard opens the page gets shorter. Keep the box being typed in on screen,
// the way the Android and iPhone apps do.
function useKeepFocusedFieldVisible() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const onResize = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      const h = vv ? vv.height : window.innerHeight;
      const r = el.getBoundingClientRect();
      if (r.bottom > h - 8 || r.top < 0) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    };
    const target: any = vv || window;
    target.addEventListener('resize', onResize);
    window.addEventListener('resize', onResize);
    return () => {
      target.removeEventListener('resize', onResize);
      window.removeEventListener('resize', onResize);
    };
  }, []);
}

export default function RootLayout() {
  useKeepFocusedFieldVisible();
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

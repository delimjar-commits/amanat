// The free Render server sleeps after 15 idle minutes and takes about a minute to start.
// These views say so plainly instead of failing: a full screen at launch, a slim banner later.
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_ROOT, useSession } from '../lib/session';
import { gradient, palette, radius, role, tint, type } from '../lib/theme';
import { Icon } from './Icon';
import { Text } from './Text';
import { Button, TitleDot } from './ui';

function useElapsed(since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.round((now - since) / 1000));
}

export function WakeScreen() {
  const { server, serverSince, retryServer } = useSession();
  const secs = useElapsed(serverSince);
  const down = server === 'down';
  const progress = Math.min(1, secs / 60);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: role.background }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, width: '100%', maxWidth: 520, alignSelf: 'center' }}>
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.hero, padding: 22, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.displaySmall, { color: palette.ink, textTransform: 'uppercase' }]}>Amanat</Text>
            <Text style={[type.bodyMedium, { color: 'rgba(32,41,54,0.8)', marginTop: 4 }]}>Buy and sell with people you can trust.</Text>
          </View>
          <View style={{ width: 64, height: 64, borderRadius: radius.lg, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' }}>
            {down ? <Icon name="shield-check" size={32} color="#FFFFFF" /> : <ActivityIndicator color="#FFFFFF" />}
          </View>
        </LinearGradient>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 28 }}>
          <Text style={[type.headlineLarge, { color: role.onBackground }]}>{down ? 'Server not answering' : 'Waking up the server'}</Text>
          <TitleDot />
        </View>
        <Text style={[type.bodyMedium, { color: role.onSurfaceVariant, marginTop: 6 }]}>
          {down
            ? 'It may still be starting, or your connection may be down. Try again in a moment.'
            : 'The free server naps when nobody has used it for a while. Starting it up takes up to a minute. You only wait the first time.'}
        </Text>

        {down ? null : (
          <View style={{ marginTop: 20 }}>
            <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: tint(palette.sky, 0.16), overflow: 'hidden' }}>
              <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 8, width: `${Math.max(6, progress * 100)}%`, borderRadius: radius.pill }} />
            </View>
            <Text style={[type.labelMedium, { color: role.onSurfaceVariant, marginTop: 8 }]}>
              {secs < 60 ? `${secs}s` : `${secs}s, almost there`}
            </Text>
          </View>
        )}

        {down ? (
          <View style={{ gap: 10, marginTop: 20 }}>
            <Button title="Try again" icon="arrow-path" onPress={retryServer} />
          </View>
        ) : null}

        <Text style={[type.bodySmall, { color: role.onSurfaceVariant, marginTop: 20 }]} numberOfLines={1}>
          Server: {API_ROOT}
        </Text>
      </View>
    </SafeAreaView>
  );
}

/** Slim banner shown over the app while a request is waiting for the server to wake. */
export function WakeBanner() {
  const { server, serverSince, retryServer } = useSession();
  const secs = useElapsed(serverSince);
  if (server !== 'waking' && server !== 'down') return null;
  const down = server === 'down';
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: down ? tint(palette.warning, 0.12) : role.primaryContainer }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
        {down ? <Icon name="signal" size={18} color={palette.warning} /> : <ActivityIndicator size="small" color={role.primary} />}
        <Text style={[type.labelLarge, { color: role.onPrimaryContainer, flex: 1 }]}>
          {down ? "Server isn't answering." : `Waking up the server... ${secs}s`}
        </Text>
        {down ? (
          <Text onPress={retryServer} style={[type.labelLarge, { color: role.primary }]}>
            Retry
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

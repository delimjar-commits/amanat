import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, TextInput as RNTextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Segmented } from '../components/bits';
import { Icon, type HeroName } from '../components/Icon';
import { Text } from '../components/Text';
import { Button, ErrorText, Field, Page, TitleDot } from '../components/ui';
import { errText } from '../lib/api';
import { useSession } from '../lib/session';
import { gradient, palette, radius, role, type } from '../lib/theme';

const points: { icon: HeroName; text: string }[] = [
  { icon: 'lock-closed', text: 'Your money is held safely until you get what you paid for.' },
  { icon: 'identification', text: 'Sellers verify their NID with a live selfie.' },
  { icon: 'scale', text: 'If something goes wrong, our team looks at the proof and decides.' },
];

export default function Welcome() {
  const { signIn, register } = useSession();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'in' | 'up'>('up');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referral, setReferral] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const emailRef = useRef<ComponentRef<typeof RNTextInput>>(null);
  const passRef = useRef<ComponentRef<typeof RNTextInput>>(null);

  const submit = async () => {
    setErr(null);
    if (mode === 'up' && name.trim().length < 2) return setErr('Enter your name.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Enter a valid email.');
    if (password.length < 8) return setErr('Your password needs at least 8 characters.');
    setBusy(true);
    try {
      if (mode === 'up') await register(name.trim(), email.trim(), password, referral.trim());
      else await signIn(email.trim(), password);
      router.replace('/');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: role.background, paddingTop: insets.top }}>
      <Page maxWidth={480} gap={16} topPad={16}>
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.hero, padding: 20, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shield-check" size={28} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.displaySmall, { color: palette.ink, textTransform: 'uppercase' }]}>Amanat</Text>
              <Text style={[type.bodyMedium, { color: 'rgba(32,41,54,0.85)' }]}>Buy and sell with people you can trust.</Text>
            </View>
          </View>
          <View style={{ gap: 8 }}>
            {points.map((p) => (
              <View key={p.icon} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Icon name={p.icon} size={18} color={palette.ink} strokeWidth={2} />
                <Text style={[type.bodyMedium, { color: palette.ink, flex: 1 }]}>{p.text}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[type.headlineLarge]}>{mode === 'up' ? 'Create your account' : 'Welcome back'}</Text>
          <TitleDot />
        </View>
        <Segmented
          value={mode}
          onChange={(v) => {
            setMode(v);
            setErr(null);
          }}
          options={[
            { value: 'up', label: 'Create account' },
            { value: 'in', label: 'Sign in' },
          ]}
        />
        <View style={{ gap: 12 }}>
          {mode === 'up' ? (
            <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} submitBehavior="submit" />
          ) : null}
          <Field
            ref={emailRef}
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passRef.current?.focus()}
            submitBehavior="submit"
          />
          <Field
            ref={passRef}
            label="Password"
            hint={mode === 'up' ? 'At least 8 characters.' : undefined}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            textContentType={mode === 'up' ? 'newPassword' : 'password'}
            returnKeyType={mode === 'up' ? 'next' : 'go'}
            onSubmitEditing={mode === 'up' ? undefined : submit}
          />
          {mode === 'up' ? <Field label="Referral code (optional)" value={referral} onChangeText={setReferral} autoCapitalize="characters" returnKeyType="go" onSubmitEditing={submit} /> : null}
        </View>
        <ErrorText text={err} />
        <Button title={mode === 'up' ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} />
        <Text style={[type.bodySmall, { color: role.onSurfaceVariant, textAlign: 'center' }]}>
          {mode === 'up' ? 'By creating an account you agree to verify your phone before your first deal.' : 'Forgot your password? Ask Help after signing in with another device, or contact support.'}
        </Text>
        {Platform.OS === 'web' ? (
          <Pressable onPress={() => router.push('/admin')} accessibilityRole="link" style={{ alignSelf: 'center', padding: 8 }}>
            <Text style={[type.labelMedium, { color: palette.link }]}>Staff sign-in</Text>
          </Pressable>
        ) : null}
      </Page>
    </View>
  );
}

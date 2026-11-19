import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Linking, Platform, Pressable, TextInput as RNTextInput, View } from 'react-native';
import { Mono, QrCode } from '../../components/admin';
import { Notice } from '../../components/bits';
import { Text } from '../../components/Text';
import { Button, Card, ErrorText, Field, Page, PageTitleText } from '../../components/ui';
import { useAction } from '../../lib/hooks';
import { useSession, type AdminInfo } from '../../lib/session';
import { palette, role, type } from '../../lib/theme';

type Step = { step: 'password' } | { step: 'setup_2fa'; pre: string; secret: string; otpauth: string } | { step: 'verify_2fa'; pre: string };

export default function AdminSignIn() {
  const { adminApi, setAdminSession } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [s, setS] = useState<Step>({ step: 'password' });
  const [copied, setCopied] = useState(false);
  const act = useAction();
  const pwRef = useRef<ComponentRef<typeof RNTextInput>>(null);

  const login = () =>
    act.run('login', async () => {
      const r = await adminApi.post<{ step: 'setup_2fa' | 'verify_2fa'; pre_token: string; secret?: string; otpauth?: string }>('/api/admin/auth/login', { email: email.trim(), password });
      setCode('');
      if (r.step === 'setup_2fa') setS({ step: 'setup_2fa', pre: r.pre_token, secret: r.secret || '', otpauth: r.otpauth || '' });
      else setS({ step: 'verify_2fa', pre: r.pre_token });
    });

  const verify = () =>
    act.run('verify', async () => {
      if (s.step === 'password') return;
      const r = await adminApi.post<{ token: string; admin: AdminInfo }>('/api/admin/auth/2fa', { pre_token: s.pre, code: code.replace(/\s/g, '') });
      await setAdminSession(r.token, r.admin);
      router.replace('/admin');
    });

  const secretGroups = s.step === 'setup_2fa' ? s.secret.match(/.{1,4}/g)?.join(' ') : '';

  return (
    <Page gap={16} topPad={48} maxWidth={480}>
      <View style={{ gap: 6 }}>
        <PageTitleText>Amanat admin</PageTitleText>
        <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>Staff only. Every sign-in needs your password and a code from your authenticator app.</Text>
      </View>

      {s.step === 'password' ? (
        <Card style={{ gap: 12 }}>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} />
          <Field ref={pwRef} label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" returnKeyType="go" onSubmitEditing={login} />
          <ErrorText text={act.error} />
          <Button title="Continue" icon="lock-closed" onPress={login} loading={act.busy === 'login'} disabled={!email.trim() || !password} />
          <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]}>Use the same email and password as your Amanat account. No account yet? Create one in the user app first.</Text>
        </Card>
      ) : null}

      {s.step === 'setup_2fa' ? (
        <Card style={{ gap: 12 }}>
          <Text style={[type.titleMedium, { color: role.onSurface }]}>Set up your authenticator</Text>
          <Text style={[type.bodyMedium, { color: role.onSurface }]}>
            1. Install Google Authenticator, Microsoft Authenticator or Authy on your phone.{'\n'}2. In the app, tap + and scan this QR code, or choose "Enter a setup key" and type the key below.{'\n'}3. Type the 6-digit code it shows.
          </Text>
          <QrCode value={s.otpauth} size={208} />
          <View style={{ gap: 4, alignItems: 'center' }}>
            <Text style={[type.labelMedium, { color: role.onSurfaceVariant }]}>Setup key (time based)</Text>
            <Mono>{secretGroups}</Mono>
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(s.secret);
                  setCopied(true);
                }}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={[type.labelLarge, { color: palette.link }]}>{copied ? 'Copied' : 'Copy key'}</Text>
              </Pressable>
              {Platform.OS !== 'web' ? (
                <Pressable onPress={() => Linking.openURL(s.otpauth).catch(() => {})} accessibilityRole="link" hitSlop={8}>
                  <Text style={[type.labelLarge, { color: palette.link }]}>Open authenticator</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <Field label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/[^\d]/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} returnKeyType="go" onSubmitEditing={verify} />
          <ErrorText text={act.error} />
          <Button title="Turn on and sign in" icon="shield-check" onPress={verify} loading={act.busy === 'verify'} disabled={code.length !== 6} />
          <Notice tone="warn" text="Keep this key private. Anyone with it and your password can sign in as you." />
        </Card>
      ) : null}

      {s.step === 'verify_2fa' ? (
        <Card style={{ gap: 12 }}>
          <Text style={[type.titleMedium, { color: role.onSurface }]}>Enter your code</Text>
          <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>Open your authenticator app and type the 6-digit code for Amanat Admin.</Text>
          <Field label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/[^\d]/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} autoFocus returnKeyType="go" onSubmitEditing={verify} />
          <ErrorText text={act.error} />
          <Button title="Sign in" icon="shield-check" onPress={verify} loading={act.busy === 'verify'} disabled={code.length !== 6} />
        </Card>
      ) : null}

      {s.step !== 'password' ? <Button title="Start again" variant="ghost" onPress={() => { setS({ step: 'password' }); act.setError(null); }} /> : null}
      <Button title="Back to the app" variant="ghost" icon="arrow-left" onPress={() => router.replace('/')} />
    </Page>
  );
}

import { router, Tabs } from 'expo-router';
import { Platform, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAdmin } from '../../../components/admin';
import { Icon, type HeroName } from '../../../components/Icon';
import { AppHeader, IconButton, useLayout } from '../../../components/ui';
import { fonts, role, tint } from '../../../lib/theme';

const icon = (name: HeroName) =>
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return (
      <View accessibilityElementsHidden style={{ width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? tint(role.primary, 0.14) : 'transparent' }}>
        <Icon name={name} size={22} color={String(color)} />
      </View>
    );
  };

export default function AdminTabs() {
  const insets = useSafeAreaInsets();
  const { wide } = useLayout();
  const { signOut } = useAdmin();
  const bottomBar = {
    backgroundColor: role.surfaceContainerLow,
    borderTopWidth: 1,
    borderTopColor: role.outlineVariant,
    elevation: 0,
    height: 62 + insets.bottom,
    paddingTop: 8,
    paddingBottom: Math.max(insets.bottom, 8),
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };
  const rail = {
    backgroundColor: role.surfaceContainerLow,
    borderRightWidth: 1,
    borderRightColor: role.outlineVariant,
    borderTopWidth: 0,
    width: 96 + insets.left,
    paddingLeft: insets.left,
    paddingTop: insets.top + 16,
  };
  const right = () => (
    <IconButton
      name="arrow-right-start-on-rectangle"
      label="Sign out of admin"
      onPress={async () => {
        await signOut();
        router.replace('/admin/sign-in');
      }}
    />
  );
  return (
    <Tabs
      screenOptions={{
        header: ({ options }) => <AppHeader title={typeof options.title === 'string' ? options.title : ''} right={right()} />,
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarVariant: wide ? 'material' : 'uikit',
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: wide ? rail : bottomBar,
        tabBarItemStyle: wide ? { height: 72, paddingVertical: 6 } : { paddingVertical: 0 },
        tabBarActiveTintColor: role.primary,
        tabBarInactiveTintColor: role.onSurfaceVariant,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
        tabBarAllowFontScaling: false,
        tabBarHideOnKeyboard: Platform.OS === 'android',
        sceneStyle: { backgroundColor: role.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarLabel: 'Home', tabBarIcon: icon('squares-2x2') }} />
      <Tabs.Screen name="queue" options={{ title: 'Approvals', tabBarLabel: 'Queue', tabBarIcon: icon('clipboard-document-check') }} />
      <Tabs.Screen name="disputes" options={{ title: 'Disputes', tabBarIcon: icon('scale') }} />
      <Tabs.Screen name="users" options={{ title: 'Users', tabBarIcon: icon('users') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal') }} />
    </Tabs>
  );
}

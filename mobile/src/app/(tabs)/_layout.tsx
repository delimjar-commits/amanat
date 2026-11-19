import { router, Tabs } from 'expo-router';
import { Platform, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type HeroName } from '../../components/Icon';
import { Text } from '../../components/Text';
import { AppHeader, IconButton, useLayout } from '../../components/ui';
import { useSession } from '../../lib/session';
import { fonts, role, tint } from '../../lib/theme';

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: -5, left: 36, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: role.secondary, borderWidth: 2, borderColor: role.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text allowFontScaling={false} style={{ color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 10, lineHeight: 12 }}>
        {count > 99 ? '99+' : String(count)}
      </Text>
    </View>
  );
}

const icon = (name: HeroName, count = 0) =>
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return (
      <View accessibilityElementsHidden style={{ width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? tint(role.primary, 0.14) : 'transparent' }}>
        <Icon name={name} size={22} color={String(color)} />
        <Badge count={count} />
      </View>
    );
  };

export default function TabsLayout() {
  const { me } = useSession();
  const insets = useSafeAreaInsets();
  const { wide } = useLayout();
  const unread = me?.unread_notifications || 0;

  // Phones: a fixed bottom bar that grows by the gesture-bar inset. Tablets/desktop: a side rail.
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
  const bell = () => (
    <View>
      <IconButton name="bell" label={unread ? `Notifications, ${unread} new` : 'Notifications'} onPress={() => router.push('/notifications')} />
      {unread ? <View pointerEvents="none" style={{ position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: 5, backgroundColor: role.secondary, borderWidth: 2, borderColor: role.background }} /> : null}
    </View>
  );

  return (
    <Tabs
      screenOptions={{
        header: ({ options }) => <AppHeader title={typeof options.title === 'string' ? options.title : ''} right={bell()} />,
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
      <Tabs.Screen name="index" options={{ title: 'Browse', tabBarIcon: icon('magnifying-glass') }} />
      <Tabs.Screen name="deals" options={{ title: 'Deals', tabBarIcon: icon('shield-check') }} />
      <Tabs.Screen name="sell" options={{ title: 'Sell', tabBarIcon: icon('plus-circle') }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats', tabBarIcon: icon('chat-bubble-left-right') }} />
      <Tabs.Screen name="me" options={{ title: 'Me', tabBarAccessibilityLabel: unread ? `Me, ${unread} new` : 'Me', tabBarIcon: icon('user-circle', unread) }} />
    </Tabs>
  );
}

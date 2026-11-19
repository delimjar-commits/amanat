// Flarecap components (section 6): PrimaryButton/OutlineButton, Chip, AppCard,
// IconBadge, SettingRow, SwitchRow, SectionTitle, PageTitle, empty state, fields.
import { LinearGradient } from 'expo-linear-gradient';
import { useKeyboardInset } from '../lib/keyboard';
import { useRef, useState, type ComponentRef, type ReactElement, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput as RNTextInputBase,
  useWindowDimensions,
  View,
  type PressableProps,
  type RefreshControlProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initials, titleCase } from '../lib/format';
import { dealStatus } from '../lib/status';
import { accent, colors, gradient, palette, radius, role, tint, type } from '../lib/theme';
import { Icon, type HeroName } from './Icon';
import { Text, TextInput } from './Text';

// ---------- Responsive layout ----------
// One reading column on every size: full width on phones, a centred 760dp column on
// tablets and desktop. The tab bar becomes a side rail from 768dp.
export const CONTENT_MAX = 760;
export const RAIL_MIN = 768;
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const wide = width >= RAIL_MIN;
  const column = { width: '100%' as const, maxWidth: CONTENT_MAX, alignSelf: 'center' as const };
  return { width, height, wide, compact: width < 380, gutter: width < 380 ? 12 : wide ? 24 : 16, column };
}

// The scrolling page every form and list screen uses. Keeps content centred and clear of
// the home indicator, and keeps focused fields above the keyboard on iOS and Android.
export function Page({
  children,
  refreshControl,
  inTabs,
  gap,
  topPad = 8,
  maxWidth = CONTENT_MAX,
}: {
  children: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  inTabs?: boolean;
  gap?: number;
  topPad?: number;
  maxWidth?: number;
}) {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  // iOS scrolls fields into view itself (automaticallyAdjustKeyboardInsets); Android edge
  // to edge and phone browsers get the keyboard's height as extra room to scroll into.
  const kb = useKeyboardInset();
  const extra = Platform.OS === 'ios' ? 0 : kb;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: role.background }}
      contentContainerStyle={{
        paddingHorizontal: gutter,
        paddingTop: topPad,
        // Tab screens already sit above the tab bar, which owns the home-indicator space.
        paddingBottom: 32 + (inTabs ? 0 : insets.bottom) + extra,
        paddingLeft: gutter + (inTabs ? 0 : insets.left),
        paddingRight: gutter + (inTabs ? 0 : insets.right),
        width: '100%',
        maxWidth: maxWidth + gutter * 2,
        alignSelf: 'center',
        gap,
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : Platform.OS === 'web' ? 'none' : 'on-drag'}
      automaticallyAdjustKeyboardInsets
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}

// Header for every screen: back button, a one-line title that shrinks before it can run
// under the buttons, and actions on the right. Lines up with the content column.
export function AppHeader({ title, onBack, right, sub, modal }: { title: string; onBack?: () => void; right?: ReactNode; sub?: string; modal?: boolean }) {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  // An iOS page-sheet modal already starts below the status bar.
  const top = modal && Platform.OS === 'ios' ? 8 : insets.top;
  return (
    <View style={{ backgroundColor: role.background, paddingTop: top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <View
        style={{
          width: '100%',
          maxWidth: CONTENT_MAX + gutter * 2,
          alignSelf: 'center',
          minHeight: 60,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingLeft: onBack ? Math.max(4, gutter - 12) : gutter,
          paddingRight: right ? Math.max(4, gutter - 12) : gutter,
        }}
      >
        {onBack ? <IconButton name="arrow-left" label="Back" onPress={onBack} /> : null}
        <View style={{ flex: 1, minWidth: 0, paddingVertical: 6 }}>
          <PageTitleText lines={1}>{title}</PageTitleText>
          {sub ? (
            <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
        {right ? <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>{right}</View> : null}
      </View>
    </View>
  );
}

// A bottom sheet on phones, a centred dialog on wide screens. Scrolls when it is taller
// than the screen and lifts above the keyboard.
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { wide, height, gutter } = useLayout();
  const kb = useKeyboardInset();
  return (
    <Modal visible={visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, paddingBottom: kb }}>
        <View style={{ flex: 1, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? 24 : 0 }}>
          <Pressable accessibilityLabel="Close" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,22,40,0.45)' }]} />
          <View
            style={{
              width: '100%',
              maxWidth: wide ? 560 : undefined,
              maxHeight: height - kb - (wide ? 48 : insets.top + 24),
              backgroundColor: role.background,
              borderTopLeftRadius: radius.hero,
              borderTopRightRadius: radius.hero,
              borderBottomLeftRadius: wide ? radius.hero : 0,
              borderBottomRightRadius: wide ? radius.hero : 0,
              overflow: 'hidden',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: gutter + 4, paddingRight: 4, paddingTop: 8, minHeight: 56 }}>
              <View style={{ flex: 1 }}>
                <Text style={[type.titleLarge, { color: role.onSurface }]} numberOfLines={2}>
                  {title}
                </Text>
              </View>
              <IconButton name="x-mark" label="Close" onPress={onClose} />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: 4, paddingBottom: 20 + (wide || kb ? 0 : insets.bottom) }}
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Press: shrink to 96% with a spring (damping ratio 0.55, stiffness 600).
export function PressScale({ style, children, disabled, ...props }: PressableProps & { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(scale, { toValue: v, stiffness: 600, damping: 27, mass: 1, useNativeDriver: true }).start();
  return (
    <Pressable disabled={disabled} onPressIn={() => to(0.96)} onPressOut={() => to(1)} {...props}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// variant: primary = Ink fill; ghost = outline; agent = primary container tonal; danger = outline in error.
export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  small,
  icon,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'agent' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  icon?: HeroName;
  style?: StyleProp<ViewStyle>;
}) {
  const off = Boolean(disabled || loading);
  const primary = variant === 'primary';
  let bg = 'transparent';
  let fg: string = role.onSurface;
  let border: string | undefined = role.buttonOutlineBorder;
  if (primary) {
    bg = off ? role.surfaceVariant : role.buttonPrimaryBg;
    fg = off ? role.onSurfaceVariant : role.buttonPrimaryText;
    border = undefined;
  } else if (variant === 'agent') {
    bg = role.primaryContainer;
    fg = role.onPrimaryContainer;
    border = undefined;
  } else if (variant === 'danger') {
    fg = role.error;
    border = role.error;
  }
  const box: ViewStyle = {
    minHeight: small ? 40 : primary ? 52 : 48,
    borderRadius: radius.sm,
    paddingHorizontal: small ? 14 : primary ? 22 : 18,
    paddingVertical: small ? 8 : primary ? 12 : 10,
    backgroundColor: bg,
    borderWidth: border ? 1 : 0,
    borderColor: border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    opacity: off && !primary ? 0.5 : 1,
  };
  const label = small || !primary ? type.titleSmall : type.titleMedium;
  return (
    <PressScale onPress={onPress} disabled={off} accessibilityRole="button" style={[box, style]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={small ? 17 : primary ? 20 : 19} color={fg} /> : null}
          <Text style={[label, { fontFamily: type.labelLarge.fontFamily, color: fg, textAlign: 'center' }]}>{title}</Text>
        </>
      )}
    </PressScale>
  );
}

export function IconButton({ name, onPress, label, color = role.onSurface, size = 24 }: { name: HeroName; onPress?: () => void; label: string; color?: string; size?: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? role.surfaceContainerHigh : 'transparent' })}
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: HeroName }) {
  const fg = selected ? '#FFFFFF' : role.onSurface;
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{ minHeight: 40, maxWidth: '100%', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: selected ? palette.ink : role.surfaceContainerHigh }}
    >
      {icon ? <Icon name={icon} size={17} color={fg} /> : null}
      <Text style={[type.labelLarge, { color: fg, flexShrink: 1 }]} numberOfLines={1}>
        {label}
      </Text>
    </PressScale>
  );
}

// Text field: a section title above acts as its label; outlined, 8dp corners, focused = primary.
export function Field({ label, style, hint, ...props }: TextInputProps & { label?: string; hint?: string; ref?: Ref<ComponentRef<typeof RNTextInputBase>> }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={[type.sectionTitle, { color: role.primary, marginBottom: 8 }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={role.onSurfaceVariant}
        selectionColor={role.primary}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[styles.input, focused && { borderColor: role.primary, borderWidth: 2, paddingHorizontal: 15 }, style]}
      />
      {hint ? <Text style={[type.bodySmall, { color: role.onSurfaceVariant, marginTop: 4, marginLeft: 16 }]}>{hint}</Text> : null}
    </View>
  );
}

// People: Sky circle with Ink initials at 38%. Agents: a 12dp-corner badge in their accent at 13%.
export function Avatar({ name, glyph, color, size = 40, agent }: { name: string; glyph?: string | null; color?: string | null; size?: number; agent?: boolean }) {
  if (agent) {
    const c = color || accent.pink;
    return (
      <View style={{ width: size, height: size, borderRadius: Math.max(12, size * 0.3), backgroundColor: tint(c.length === 7 ? c : accent.pink, 0.13), alignItems: 'center', justifyContent: 'center' }}>
        <Text allowFontScaling={false} style={{ color: c, fontWeight: '700', fontSize: size * 0.46 }}>
          {glyph || initials(name)}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.sky, alignItems: 'center', justifyContent: 'center' }}>
      <Text allowFontScaling={false} style={{ color: palette.ink, fontWeight: '600', fontSize: size * 0.38 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

export function IconBadge({ name, color = accent.sky, size = 40 }: { name: HeroName; color?: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: tint(color, 0.13), alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size * 0.55} color={color} />
    </View>
  );
}

export function StatusPill({ status, map = dealStatus, s: given }: { status?: string; map?: Record<string, { label: string; color: string; bg: string }>; s?: { label: string; color: string; bg: string } }) {
  const s = given || map[status || ''] || { label: titleCase(status || ''), color: role.onSurfaceVariant, bg: role.surfaceContainerHigh };
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <View style={[styles.dot, { backgroundColor: s.color }]} />
      <Text style={[type.labelMedium, { color: role.onSurface }]} numberOfLines={1}>{s.label}</Text>
    </View>
  );
}

export function Tag({ text, color = accent.pink }: { text: string; color?: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: tint(color, 0.13), paddingHorizontal: 8, paddingVertical: 2 }]}>
      <Text style={{ fontSize: 11, fontWeight: '600', color }}>{text}</Text>
    </View>
  );
}

// AppCard: 20dp corners, surfaceContainer, 1dp outlineVariant border, no shadow.
export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <PressScale onPress={onPress} style={[styles.card, style]}>
        {children}
      </PressScale>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}
export const AppCard = Card;

// Settings row: badge, 14dp gap, title + sub, value, chevron. Padding 16/13.
export function SettingRow({ icon, color, title, sub, value, onPress, danger }: { icon?: HeroName; color?: string; title: string; sub?: string; value?: string; onPress?: () => void; danger?: boolean }) {
  const long = (value?.length || 0) > 18;
  return (
    <Pressable accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={[title, sub, value].filter(Boolean).join(', ')} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: role.surfaceContainerHigh }]}>
      {icon ? <IconBadge name={icon} color={danger ? accent.red : color} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[type.titleMedium, { color: danger ? role.error : role.onSurface }]}>{title}</Text>
        {sub ? <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>{sub}</Text> : null}
        {value && long ? <Text style={[type.bodyMedium, { color: role.primary }]}>{value}</Text> : null}
      </View>
      {value && !long ? <Text style={[type.bodyMedium, { color: role.onSurfaceVariant, textAlign: 'right', maxWidth: '45%' }]} numberOfLines={2}>{value}</Text> : null}
      {onPress ? <Icon name="chevron-right" size={20} color={role.onSurfaceVariant} /> : null}
    </Pressable>
  );
}

export function SwitchRow({ icon, color, title, sub, value, onValueChange }: { icon?: HeroName; color?: string; title: string; sub?: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={sub ? `${title}, ${sub}` : title} onPress={() => onValueChange(!value)} style={[styles.row, { paddingVertical: 11 }]}>
      {icon ? <IconBadge name={icon} color={color} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.titleMedium, { color: role.onSurface }]}>{title}</Text>
        {sub ? <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>{sub}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: role.primary, false: role.surfaceContainerHighest }} thumbColor="#FFFFFF" ios_backgroundColor={role.surfaceContainerHighest} />
    </Pressable>
  );
}

// Section title: uppercase 12sp DM Sans Medium, 1.2 tracking, primary, 22 top / 8 bottom.
export function SectionTitle({ title, count, right }: { title: string; count?: number; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={[type.sectionTitle, { color: role.primary }]}>{title}</Text>
      {count ? (
        <View style={styles.countBubble}>
          <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '600' }}>{count}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

// Brushes.primary in an 8dp circle, after every page title.
export function TitleDot() {
  return <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 8, height: 8, borderRadius: 4, marginLeft: 6, marginTop: 3 }} />;
}

// Page title: Anton 21sp, UPPERCASE, up to 2 lines, then the gradient dot.
export function PageTitleText({ children, lines = 2 }: { children: ReactNode; lines?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0 }}>
      <Text style={[type.headlineLarge, { color: role.onBackground, flexShrink: 1 }]} numberOfLines={lines}>
        {children}
      </Text>
      <TitleDot />
    </View>
  );
}

export function PageTitle({ title, sub, leading, trailing }: { title: string; sub?: string; leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <View style={{ paddingLeft: 20, paddingRight: trailing ? 8 : 20, paddingTop: 12, paddingBottom: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {leading}
        <View style={{ flex: 1 }}>
          <PageTitleText>{title}</PageTitleText>
        </View>
        {trailing}
      </View>
      {sub ? <Text style={[type.bodyMedium, { color: role.onSurfaceVariant, marginTop: 2 }]}>{sub}</Text> : null}
    </View>
  );
}

// Hero action card: 24dp corners, sky gradient, Ink text, a 64dp Ink box with a white icon.
export function HeroCard({ title, sub, icon, onPress }: { title: string; sub?: string; icon: HeroName; onPress?: () => void }) {
  return (
    <PressScale onPress={onPress} disabled={!onPress} style={{ borderRadius: radius.hero, overflow: 'hidden' }}>
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 22, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={[type.titleLarge, { color: palette.ink }]}>{title}</Text>
          {sub ? <Text style={[type.bodyMedium, { color: tint(palette.ink, 0.8), marginTop: 4 }]}>{sub}</Text> : null}
        </View>
        <View style={{ width: 64, height: 64, borderRadius: radius.lg, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={32} color="#FFFFFF" />
        </View>
      </LinearGradient>
    </PressScale>
  );
}

// Empty state: 44dp icon in onSurfaceVariant, titleMedium + bodyMedium, centred.
export function Empty({ title, body, action, icon = 'sparkles' }: { title: string; body?: string; action?: ReactNode; icon?: HeroName }) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={44} color={role.onSurfaceVariant} />
      <Text style={[type.titleMedium, { color: role.onSurface, textAlign: 'center', marginTop: 12 }]}>{title}</Text>
      {body ? <Text style={[type.bodyMedium, { color: role.onSurfaceVariant, textAlign: 'center', marginTop: 4 }]}>{body}</Text> : null}
      {action ? <View style={{ marginTop: 16, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function ErrorText({ text }: { text?: string | null }) {
  if (!text) return null;
  return <Text style={[type.bodyMedium, { color: role.error, marginVertical: 8 }]}>{text}</Text>;
}

export const styles = StyleSheet.create({
  input: {
    minHeight: 56,
    backgroundColor: role.surface,
    borderWidth: 1,
    borderColor: role.outline,
    borderRadius: radius.field,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: role.onSurface,
    fontSize: 16,
  },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  card: { backgroundColor: role.surfaceContainer, borderRadius: radius.lg, borderWidth: 1, borderColor: role.outlineVariant, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13, minHeight: 48 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 8, paddingLeft: 4 },
  countBubble: { backgroundColor: role.primary, borderRadius: radius.pill, minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, alignItems: 'center' },
  empty: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 32 },
});

export { colors };

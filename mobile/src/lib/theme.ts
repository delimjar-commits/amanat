// Flarecap design system (light theme, the system's default).
// Values come from FLARECAP_DESIGN_SYSTEM.md sections 2 to 5.

export const palette = {
  sky: '#37B1FF',
  skyMedium: '#009CFF',
  skyLight: '#AFE0FF',
  skyExtraLight: '#E3F4FF',
  ink: '#202936',
  active: '#1E1E1E',
  pink: '#FF4BB7',
  success: '#00BB77',
  warning: '#B25E09',
  error: '#DA2F2F',
  bg: '#FFFFFF',
  bg2: '#F9F9F9',
  bg3: '#ECECEC',
  chip: '#F5F5F5',
  stroke: '#E6E6E6',
  text2: '#545454',
  link: '#2E96EF',
};

export const accent = {
  pink: '#FF4BB7',
  red: '#DA2F2F',
  sky: '#37B1FF',
  amber: '#F29A2E',
  green: '#00BB77',
};

// Material 3 roles, light.
export const role = {
  primary: '#009CFF',
  onPrimary: '#FFFFFF',
  primaryContainer: '#E3F4FF',
  onPrimaryContainer: '#202936',
  secondary: '#FF4BB7',
  tertiary: '#00BB77',
  error: '#DA2F2F',
  background: '#FFFFFF',
  onBackground: '#000000',
  surface: '#FFFFFF',
  onSurface: '#000000',
  surfaceVariant: '#ECECEC',
  onSurfaceVariant: '#545454',
  surfaceContainerLow: '#F9F9F9',
  surfaceContainer: '#FFFFFF',
  surfaceContainerHigh: '#F5F5F5',
  surfaceContainerHighest: '#ECECEC',
  inverseSurface: '#202936',
  inverseOnSurface: '#FFFFFF',
  outline: '#CFCFCF',
  outlineVariant: '#E6E6E6',
  buttonPrimaryBg: '#202936',
  buttonPrimaryText: '#FFFFFF',
  buttonOutlineBorder: '#000000',
};

// Hex colour + alpha, for the system's tint alphas (0.12, 0.13, 0.14, 0.16...).
export const tint = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

// App-level names used across the screens, mapped onto the roles above.
export const colors = {
  bg: role.background,
  bgElevated: role.surfaceContainerLow,
  card: role.surfaceContainer,
  cardHi: role.surfaceContainerHigh,
  line: role.outlineVariant,
  text: role.onSurface,
  dim: role.onSurfaceVariant,
  faint: role.onSurfaceVariant,
  accent: role.primary,
  accentSoft: tint(role.primary, 0.12),
  agent: accent.pink,
  agentSoft: tint(accent.pink, 0.13),
  warn: palette.warning,
  warnSoft: tint(accent.amber, 0.13),
  ok: accent.green,
  okSoft: tint(accent.green, 0.13),
  bad: role.error,
  badSoft: tint(role.error, 0.13),
  ink: palette.ink,
  link: palette.link,
  chip: palette.chip,
};

export const fonts = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
  extrabold: 'DMSans_800ExtraBold',
  black: 'DMSans_900Black',
  display: 'Anton_400Regular',
};

// Type scale, section 3.
export const type = {
  displaySmall: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: 0.3 },
  headlineLarge: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  headlineSmall: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
  titleLarge: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  titleMedium: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  titleSmall: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  bodyLarge: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  bodyMedium: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  bodySmall: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  labelLarge: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  labelMedium: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  labelSmall: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  sectionTitle: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, letterSpacing: 1.2, textTransform: 'uppercase' as const },
};

// Corner radii, section 5.
export const radius = { field: 8, thumb: 10, sm: 12, md: 16, tile: 18, lg: 20, hero: 24, xl: 28, pill: 999 };
export const space = (n: number) => n * 4;
export const gutter = 16;

// Brushes.primary: linear #37B1FF -> #009CFF.
export const gradient = [palette.sky, palette.skyMedium] as const;

export const statusStyle: Record<string, { label: string; color: string; bg: string }> = {
  proposed: { label: 'Needs approval', color: accent.amber, bg: tint(accent.amber, 0.13) },
  open: { label: 'Open', color: accent.sky, bg: tint(accent.sky, 0.13) },
  working: { label: 'Agent working', color: accent.pink, bg: tint(accent.pink, 0.13) },
  review: { label: 'Ready for review', color: accent.amber, bg: tint(accent.amber, 0.13) },
  done: { label: 'Done', color: accent.green, bg: tint(accent.green, 0.13) },
  dismissed: { label: 'Dismissed', color: role.onSurfaceVariant, bg: role.surfaceContainerHigh },
};

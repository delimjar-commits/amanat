import { useWindowDimensions } from 'react-native';

/** Widest a reading column gets on tablets and desktops. */
export const COLUMN_MAX = 760;

/**
 * Screen size helpers shared by chat-style screens (chat, thread, huddle):
 * `column` centres content in a readable column on wide screens.
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const wide = width >= 768;
  const compact = width < 380;
  const gutter = compact ? 12 : wide ? 24 : 16;
  const column = { width: '100%' as const, maxWidth: COLUMN_MAX + gutter * 2, alignSelf: 'center' as const };
  return { width, height, wide, compact, gutter, column };
}

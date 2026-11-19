// DM Sans everywhere: maps fontWeight onto the bundled DM Sans weight files,
// so screens keep writing fontWeight and still get the right face.
import type { ComponentProps } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextProps, type TextStyle } from 'react-native';
import { fonts } from '../lib/theme';

const byWeight: Record<string, string> = {
  normal: fonts.regular,
  '100': fonts.regular,
  '200': fonts.regular,
  '300': fonts.regular,
  '400': fonts.regular,
  '500': fonts.medium,
  '600': fonts.semibold,
  bold: fonts.bold,
  '700': fonts.bold,
  '800': fonts.extrabold,
  '900': fonts.black,
};

function face(style: TextProps['style']): TextStyle {
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  if (flat.fontFamily) return {};
  return { fontFamily: byWeight[String(flat.fontWeight ?? 'normal')] || fonts.regular, fontWeight: 'normal' };
}

export function Text({ style, ...props }: ComponentProps<typeof RNText>) {
  return <RNText maxFontSizeMultiplier={1.8} {...props} style={[style, face(style)]} />;
}

export function TextInput({ style, ...props }: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput maxFontSizeMultiplier={1.8} {...props} style={[style, face(style as TextProps['style'])]} />;
}

import type { ComponentRef, RefObject } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, role } from '../lib/theme';
import { Icon } from './Icon';
import { useLayout } from './ui';

/** Message box pinned to the bottom of a chat. The screen pads itself by the keyboard. */
export function Composer({
  value,
  onChangeText,
  onSend,
  canSend,
  keyboardOpen,
  onPhoto,
  placeholder = 'Message',
  inputRef,
}: {
  value: string;
  onChangeText: (s: string) => void;
  onSend: () => void;
  canSend: boolean;
  keyboardOpen: boolean;
  onPhoto?: () => void;
  placeholder?: string;
  inputRef?: RefObject<ComponentRef<typeof TextInput> | null>;
}) {
  const insets = useSafeAreaInsets();
  const { column, height } = useLayout();
  const maxHeight = Math.max(72, Math.min(140, Math.round(height * (keyboardOpen ? 0.22 : 0.3))));
  return (
    <View style={{ backgroundColor: role.surfaceContainerLow, borderTopWidth: 1, borderTopColor: role.outlineVariant, paddingLeft: insets.left, paddingRight: insets.right }}>
      <View style={[column, { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: keyboardOpen ? 8 : Math.max(insets.bottom, 10) }]}>
        {onPhoto ? (
          <Pressable onPress={onPhoto} accessibilityRole="button" accessibilityLabel="Send a photo" style={({ pressed }) => ({ width: 44, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? role.surfaceContainerHigh : 'transparent' })}>
            <Icon name="photo" size={22} color={role.onSurfaceVariant} />
          </Pressable>
        ) : null}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={role.onSurfaceVariant}
          multiline
          accessibilityLabel="Message"
          maxFontSizeMultiplier={1.6}
          textAlignVertical="top"
          onKeyPress={(e) => {
            const ne = e.nativeEvent as unknown as { key: string; shiftKey?: boolean; isComposing?: boolean };
            if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey && !ne.isComposing) {
              (e as unknown as { preventDefault: () => void }).preventDefault();
              onSend();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            color: role.onSurface,
            fontFamily: fonts.regular,
            fontSize: 16,
            lineHeight: 21,
            maxHeight,
            minHeight: 48,
            backgroundColor: role.surface,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingTop: 13,
            paddingBottom: 13,
            borderWidth: 1,
            borderColor: role.outlineVariant,
          }}
        />
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          accessibilityLabel="Send"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 14, backgroundColor: canSend ? role.buttonPrimaryBg : role.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="paper-airplane" size={22} color={canSend ? '#FFFFFF' : role.onSurfaceVariant} />
        </Pressable>
      </View>
    </View>
  );
}

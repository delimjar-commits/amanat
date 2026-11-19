import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { tk } from '../lib/format';
import { badgeLabel, kycLabel } from '../lib/status';
import { accent, fonts, palette, radius, role, tint, type } from '../lib/theme';
import type { Listing, PublicUser } from '../lib/types';
import { Icon, type HeroName } from './Icon';
import { Text } from './Text';
import { Avatar, StatusPill } from './ui';

export function UserAvatar({ user, size = 40 }: { user?: Partial<PublicUser> | null; size?: number }) {
  if (user?.avatar_url) {
    return <Image source={{ uri: user.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: role.surfaceContainerHigh }} />;
  }
  return <Avatar name={user?.display_name || '?'} size={size} />;
}

export function trustColor(score: number) {
  return score >= 70 ? accent.green : score >= 45 ? accent.amber : accent.red;
}

export function TrustPill({ score, small }: { score: number; small?: boolean }) {
  const c = trustColor(score);
  return (
    <View
      accessibilityLabel={`Trust score ${score} out of 100`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: small ? 6 : 8, height: small ? 20 : 24, borderRadius: radius.pill, backgroundColor: tint(c, 0.13) }}
    >
      <Icon name="shield-check" size={small ? 12 : 14} color={c} strokeWidth={2} />
      <Text style={[small ? type.labelSmall : type.labelMedium, { color: role.onSurface, fontFamily: fonts.semibold }]}>{score}</Text>
    </View>
  );
}

export function KycPill({ level }: { level: string }) {
  return <StatusPill s={kycLabel[level] || kycLabel.none} />;
}

export function Badges({ list }: { list?: string[] }) {
  if (!list?.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {list.map((b) => (
        <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: radius.pill, backgroundColor: palette.skyExtraLight }}>
          <Icon name={b === 'verified' ? 'check-badge' : b === 'top_rated' ? 'star' : b === 'business' ? 'building-storefront' : 'sparkles'} size={13} color={role.primary} strokeWidth={2} />
          <Text style={[type.labelSmall, { color: role.onSurface }]}>{badgeLabel[b] || b}</Text>
        </View>
      ))}
    </View>
  );
}

export function SellerLine({ user, onPress }: { user?: PublicUser | null; onPress?: () => void }) {
  if (!user) return null;
  return (
    <Pressable onPress={onPress ?? (() => router.push(`/user/${user.id}`))} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
      <UserAvatar user={user} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type.titleSmall} numberOfLines={1}>
          {user.shop_name || user.display_name}
        </Text>
        <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]} numberOfLines={1}>
          {user.deals_completed} deals{user.area ? ` · ${user.area}` : ''}
        </Text>
      </View>
      <TrustPill score={user.trust_score} />
      {user.kyc_level === 'verified' || user.kyc_level === 'business' ? <Icon name="check-badge" size={22} color={role.primary} /> : null}
    </Pressable>
  );
}

export function Photo({ url, style, icon = 'photo' }: { url?: string | null; style?: StyleProp<ViewStyle>; icon?: HeroName }) {
  return (
    <View style={[{ backgroundColor: palette.skyExtraLight, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style]}>
      {url ? <Image source={{ uri: url }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} resizeMode="cover" /> : <Icon name={icon} size={28} color={palette.skyMedium} />}
    </View>
  );
}

export function ListingCard({ l, width }: { l: Listing; width: number }) {
  const verified = l.seller && (l.seller.kyc_level === 'verified' || l.seller.kyc_level === 'business');
  return (
    <Pressable
      onPress={() => router.push(`/listing/${l.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${l.title}, ${tk(l.price_paisa)}`}
      style={({ pressed }) => ({ width, borderRadius: radius.tile, backgroundColor: role.surface, borderWidth: 1, borderColor: role.outlineVariant, overflow: 'hidden', opacity: pressed ? 0.85 : 1 })}
    >
      <Photo url={l.photos?.[0]?.url} style={{ width: '100%', aspectRatio: 1 }} />
      {l.saved ? (
        <View style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="heart" size={16} color={accent.pink} strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ padding: 10, gap: 2 }}>
        <Text style={[type.titleMedium, { fontFamily: fonts.bold }]} numberOfLines={1}>
          {tk(l.price_paisa)}
        </Text>
        <Text style={[type.bodyMedium, { color: role.onSurface }]} numberOfLines={2}>
          {l.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
          {verified ? <Icon name="check-badge" size={14} color={role.primary} strokeWidth={2} /> : null}
          <Text style={[type.labelSmall, { color: role.onSurfaceVariant, flex: 1 }]} numberOfLines={1}>
            {l.location_area || l.category}
          </Text>
          {l.seller ? <TrustPill score={l.seller.trust_score} small /> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** Lays cards out in a grid that always fits the screen: 2 columns on phones, more on wide screens. */
export function Grid<T>({ items, render, min = 150, gap = 12, width }: { items: T[]; render: (item: T, w: number) => ReactNode; min?: number; gap?: number; width: number }) {
  const cols = Math.max(2, Math.floor((width + gap) / (min + gap)));
  const w = Math.floor((width - gap * (cols - 1)) / cols);
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>{items.map((it) => render(it, w))}</View>;
}

export function Notice({ text, tone = 'info', icon, children }: { text?: string; tone?: 'info' | 'warn' | 'ok' | 'bad'; icon?: HeroName; children?: ReactNode }) {
  const c = tone === 'warn' ? accent.amber : tone === 'ok' ? accent.green : tone === 'bad' ? accent.red : accent.sky;
  const ic: HeroName = icon || (tone === 'warn' || tone === 'bad' ? 'exclamation-triangle' : tone === 'ok' ? 'check-circle' : 'information-circle');
  return (
    <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: tint(c, 0.1), borderWidth: 1, borderColor: tint(c, 0.3) }}>
      <Icon name={ic} size={20} color={tone === 'warn' ? palette.warning : c} />
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        {text ? <Text style={[type.bodyMedium, { color: role.onSurface }]}>{text}</Text> : null}
        {children}
      </View>
    </View>
  );
}

export function KV({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
      <Text style={[type.bodyMedium, { color: role.onSurfaceVariant, flexShrink: 1 }]}>{k}</Text>
      {typeof v === 'string' || typeof v === 'number' ? (
        <Text style={[strong ? type.titleMedium : type.bodyMedium, { color: role.onSurface, textAlign: 'right', flexShrink: 1 }, strong ? { fontFamily: fonts.bold } : null]}>{v}</Text>
      ) : (
        v
      )}
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: role.surfaceContainerHigh, borderRadius: radius.pill, padding: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? role.buttonPrimaryBg : 'transparent', paddingHorizontal: 8 }}
          >
            <Text style={[type.labelLarge, { color: on ? '#FFFFFF' : role.onSurface, fontFamily: fonts.semibold }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stat({ label, value, icon, color = accent.sky, onPress, width }: { label: string; value: string | number; icon: HeroName; color?: string; onPress?: () => void; width?: number | `${number}%` }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{ width, flexGrow: width ? 0 : 1, minWidth: 140, padding: 14, borderRadius: radius.tile, backgroundColor: role.surface, borderWidth: 1, borderColor: role.outlineVariant, gap: 8 }}
    >
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: tint(color, 0.14), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={color === accent.amber ? palette.warning : color} strokeWidth={2} />
      </View>
      <Text style={[type.headlineSmall, { fontFamily: fonts.extrabold }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[type.labelMedium, { color: role.onSurfaceVariant }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Loader() {
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>Loading…</Text>
    </View>
  );
}

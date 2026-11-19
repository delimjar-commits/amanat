// Building blocks for the admin app (Flarecap look, same components as the user app).
import { router } from 'expo-router';
import QRCode from 'qrcode';
import { useMemo, useState, type ReactNode } from 'react';
import { Image, Platform, Pressable, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { dateTime, pct, timeAgo, titleCase, tk } from '../lib/format';
import { actionLabel, actionState, recColor } from '../lib/status';
import { useSession } from '../lib/session';
import { accent, fonts, palette, radius, role, tint, type } from '../lib/theme';
import type { Row } from '../lib/types';
import { Icon, type HeroName } from './Icon';
import { Text } from './Text';
import { Card, SectionTitle, Sheet, StatusPill, Tag } from './ui';

export function useAdmin() {
  const { adminApi, admin, adminSignOut } = useSession();
  return { api: adminApi, admin, signOut: adminSignOut, isSuper: admin?.role === 'super_admin' };
}

export const roleLabel: Record<string, string> = {
  super_admin: 'Super admin',
  kyc_reviewer: 'ID reviewer',
  dispute_agent: 'Dispute agent',
  support: 'Support',
  finance: 'Finance',
};

// Which queue group each action type belongs to.
export const GROUPS: { value: string; label: string; types: string[]; icon: HeroName }[] = [
  { value: 'all', label: 'All', types: [], icon: 'inbox-stack' },
  { value: 'kyc', label: 'ID checks', types: ['approve_kyc', 'reject_kyc'], icon: 'identification' },
  { value: 'money', label: 'Money', types: ['release_escrow', 'refund_escrow', 'split_escrow'], icon: 'lock-closed' },
  { value: 'payout', label: 'Payouts', types: ['approve_payout'], icon: 'banknotes' },
  { value: 'listing', label: 'Listings', types: ['remove_listing'], icon: 'tag' },
  { value: 'account', label: 'Accounts', types: ['ban_user', 'unban_user', 'blacklist_add', 'police_handover'], icon: 'no-symbol' },
];
export const groupOf = (t: string) => GROUPS.find((g) => g.types.includes(t))?.value || 'all';
export const iconFor = (t: string): HeroName => GROUPS.find((g) => g.types.includes(t))?.icon || 'clipboard-document-check';

/** One tappable list row: icon, title, a line under it, and something on the right. */
export function ListRow({ icon, color = accent.sky, title, sub, right, onPress, badge }: { icon?: HeroName; color?: string; title: string; sub?: string; right?: ReactNode; onPress?: () => void; badge?: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: radius.tile,
        backgroundColor: pressed ? role.surfaceContainerHigh : role.surface,
        borderWidth: 1,
        borderColor: role.outlineVariant,
      })}
    >
      {icon ? (
        <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: tint(color, 0.13), alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={icon} size={21} color={color === accent.amber ? palette.warning : color} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={[type.titleSmall, { color: role.onSurface }]} numberOfLines={2}>
          {title}
        </Text>
        {sub ? (
          <Text style={[type.bodySmall, { color: role.onSurfaceVariant }]} numberOfLines={3}>
            {sub}
          </Text>
        ) : null}
        {badge ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>{badge}</View> : null}
      </View>
      {right ? <View style={{ flexShrink: 0, alignItems: 'flex-end', maxWidth: '40%' }}>{right}</View> : null}
      {onPress ? <Icon name="chevron-right" size={18} color={role.onSurfaceVariant} /> : null}
    </Pressable>
  );
}

/** An item in the approvals queue. */
export function ActionRow({ a, selected, onSelect }: { a: Row; selected?: boolean; onSelect?: () => void }) {
  const rc = recColor(a.recommendation);
  const sub = [a.ai_summary, a.payload?.reason, a.payload?.amount_paisa ? tk(a.payload.amount_paisa) : null].filter(Boolean).join(' · ') || `Asked for ${timeAgo(a.created_at)}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {onSelect ? (
        <Pressable onPress={onSelect} accessibilityRole="checkbox" accessibilityState={{ checked: !!selected }} accessibilityLabel="Select for bulk approve" hitSlop={8} style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: selected ? role.primary : role.outline, backgroundColor: selected ? role.primary : role.surface, alignItems: 'center', justifyContent: 'center' }}>
          {selected ? <Icon name="check" size={16} color="#FFFFFF" strokeWidth={3} /> : null}
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <ListRow
          icon={iconFor(a.type)}
          color={a.priority <= 1 ? accent.red : accent.sky}
          title={`${actionLabel[a.type] || titleCase(a.type)}${a.subject_title ? ` · ${a.subject_title}` : ''}`}
          sub={sub}
          onPress={() => router.push(`/admin/action/${a.id}`)}
          badge={
            <>
              <StatusPill status={a.status} map={actionState} />
              {a.recommendation ? <Tag text={`AI: ${titleCase(a.recommendation)}${a.confidence != null ? ` ${pct(a.confidence)}` : ''}`} color={rc} /> : null}
              {a.priority <= 1 ? <Tag text="Urgent" color={accent.red} /> : null}
              {a.bulk_ok ? <Tag text="Bulk OK" color={accent.green} /> : null}
              {a.status !== 'pending' && a.decided_by_name ? <Tag text={`By ${a.decided_by_name}`} color={accent.sky} /> : null}
            </>
          }
        />
      </View>
    </View>
  );
}

/** Private images (NID, selfies, proofs). Tap one to see it large. */
export function ImageGrid({ images }: { images: { label: string; url: string | null }[] }) {
  const { adminApi } = useSession();
  const [open, setOpen] = useState<{ label: string; url: string } | null>(null);
  const list = images.filter((i) => i.url) as { label: string; url: string }[];
  if (!list.length) return <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>No photos.</Text>;
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {list.map((im, i) => (
          <Pressable key={`${im.url}${i}`} onPress={() => setOpen(im)} accessibilityRole="imagebutton" accessibilityLabel={`Open ${im.label}`} style={{ width: 140, flexGrow: 1, maxWidth: 220, gap: 6 }}>
            <View style={{ aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: palette.skyExtraLight }}>
              <Image source={{ uri: adminApi.url(im.url) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            </View>
            <Text style={[type.labelMedium, { color: role.onSurfaceVariant }]} numberOfLines={1}>
              {im.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open?.label || ''}>
        {open ? (
          <View style={{ width: '100%', aspectRatio: 0.8, borderRadius: radius.md, overflow: 'hidden', backgroundColor: role.surfaceContainerHigh }}>
            <Image source={{ uri: adminApi.url(open.url) }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

/** The AI's recommendation for an item. The AI only recommends; a person decides. */
export function AiReviewCard({ review }: { review: Row | null }) {
  if (!review) return null;
  const c = recColor(review.recommendation);
  const ev = review.evidence && typeof review.evidence === 'object' ? review.evidence : null;
  const points: string[] = Array.isArray(ev?.reasons) ? ev.reasons : Array.isArray(ev?.points) ? ev.points : Array.isArray(ev?.flags) ? ev.flags : [];
  return (
    <Card>
      <SectionTitle title="AI recommendation" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <Tag text={titleCase(review.recommendation)} color={c} />
        <Tag text={`Confidence ${pct(review.confidence)}`} color={accent.sky} />
        {review.risk_score != null ? <Tag text={`Risk ${review.risk_score}/100`} color={review.risk_score >= 60 ? accent.red : review.risk_score >= 30 ? accent.amber : accent.green} /> : null}
      </View>
      <Text style={[type.bodyMedium, { color: role.onSurface }]}>{review.summary}</Text>
      {points.slice(0, 8).map((p, i) => (
        <Text key={i} style={[type.bodySmall, { color: role.onSurfaceVariant, marginTop: 4 }]}>
          • {typeof p === 'string' ? p : JSON.stringify(p)}
        </Text>
      ))}
      <Text style={[type.bodySmall, { color: role.onSurfaceVariant, marginTop: 8 }]}>
        {review.agent ? `${titleCase(review.agent)} · ` : ''}
        {review.model} · {dateTime(review.created_at)}. The AI only recommends. You decide.
      </Text>
    </Card>
  );
}

export function RiskCard({ risk }: { risk: { score: number; reasons: string[] } | null }) {
  if (!risk) return null;
  const c = risk.score >= 60 ? accent.red : risk.score >= 30 ? accent.amber : accent.green;
  return (
    <Card>
      <SectionTitle title="Risk check" right={<Tag text={`${risk.score}/100`} color={c} />} />
      {risk.reasons.length ? (
        risk.reasons.map((r, i) => (
          <Text key={i} style={[type.bodyMedium, { color: role.onSurface, marginTop: 2 }]}>
            • {r}
          </Text>
        ))
      ) : (
        <Text style={[type.bodyMedium, { color: role.onSurfaceVariant }]}>Nothing unusual found.</Text>
      )}
    </Card>
  );
}

/** A QR code for the authenticator app, drawn with SVG so it works on web and phones. */
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const qr = useMemo(() => {
    try {
      return QRCode.create(value, { errorCorrectionLevel: 'M' });
    } catch {
      return null;
    }
  }, [value]);
  if (!qr) return null;
  const n = qr.modules.size;
  const quiet = 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const total = n + quiet * 2;
  return (
    <View accessibilityRole="image" accessibilityLabel="QR code for your authenticator app" style={{ width: size, height: size, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: radius.sm, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`}>
        <Rect x={0} y={0} width={total} height={total} fill="#FFFFFF" />
        <Path d={d} fill="#000000" />
      </Svg>
    </View>
  );
}

/** Small bar chart of the last 14 days of deal volume. */
export function Bars({ data }: { data: { day: string; paisa: number | string; deals: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Number(d.paisa)));
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110 }}>
        {data.map((d) => (
          <View key={d.day} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }} accessibilityLabel={`${d.day}: ${tk(d.paisa)}, ${d.deals} deals`}>
            <View style={{ height: `${Math.max(3, (Number(d.paisa) / max) * 100)}%`, backgroundColor: Number(d.paisa) ? role.primary : role.surfaceContainerHighest, borderRadius: 4 }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={[type.labelSmall, { color: role.onSurfaceVariant }]}>{data[0]?.day.slice(5)}</Text>
        <Text style={[type.labelSmall, { color: role.onSurfaceVariant }]}>Today</Text>
      </View>
    </View>
  );
}

export function Small({ children, color = role.onSurfaceVariant }: { children: ReactNode; color?: string }) {
  return <Text style={[type.bodySmall, { color }]}>{children}</Text>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 15, letterSpacing: 1, color: role.onSurface }} selectable>{children}</Text>;
}

export const bold = { fontFamily: fonts.bold };

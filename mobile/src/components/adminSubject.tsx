// Shows what an admin action is about: an ID check, a deal, a payout, a listing or a user.
import { router } from 'expo-router';
import { View } from 'react-native';
import { dateTime, pct, titleCase, tk } from '../lib/format';
import { kycLabel } from '../lib/status';
import { accent, role, type } from '../lib/theme';
import type { Row } from '../lib/types';
import { ImageGrid, ListRow, Small } from './admin';
import { KV, KycPill, Notice, TrustPill } from './bits';
import { Text } from './Text';
import { Card, SectionTitle, StatusPill, Tag } from './ui';

export function UserLine({ u, label }: { u?: Row | null; label?: string }) {
  if (!u) return null;
  return (
    <ListRow
      icon="user"
      title={`${label ? `${label}: ` : ''}${u.display_name}`}
      sub={[u.email, u.phone].filter(Boolean).join(' · ') || undefined}
      onPress={() => router.push(`/admin/user/${u.id}`)}
      badge={
        <>
          <TrustPill score={u.trust_score ?? 0} small />
          <KycPill level={u.kyc_level} />
          {u.is_banned ? <Tag text="Banned" color={accent.red} /> : null}
        </>
      }
    />
  );
}

export function DealFacts({ d }: { d: Row }) {
  return (
    <Card>
      <SectionTitle title="Deal" right={<StatusPill status={d.status} />} />
      <KV k="Item" v={d.title} />
      <KV k="Price" v={tk(d.amount_paisa)} strong />
      <KV k="Fee" v={tk(d.fee_paisa)} />
      <KV k="Guarantee fund" v={tk(d.guarantee_paisa)} />
      <KV k="Seller gets" v={tk(d.seller_net_paisa)} />
      <KV k="Handover" v={titleCase(d.handover || '')} />
      {d.tracking_number ? <KV k="Tracking" v={`${d.courier || ''} ${d.tracking_number}`} /> : null}
      {d.risk_score != null ? <KV k="Risk" v={`${d.risk_score}/100`} /> : null}
      <KV k="Created" v={dateTime(d.created_at)} />
      {d.funded_at ? <KV k="Paid" v={dateTime(d.funded_at)} /> : null}
      {d.auto_release_at ? <KV k="Auto release" v={dateTime(d.auto_release_at)} /> : null}
    </Card>
  );
}

export function DealEvidence({ s }: { s: Row }) {
  const proofs: Row[] = s.proofs || [];
  const dispute = s.dispute;
  return (
    <>
      {dispute ? (
        <Card>
          <SectionTitle title="Dispute" right={<Tag text={titleCase(dispute.status)} color={dispute.status === 'resolved' ? accent.green : accent.red} />} />
          <KV k="Opened by" v={dispute.opened_by_role} />
          <KV k="Reason" v={titleCase(dispute.reason)} />
          {dispute.details ? <Text style={[type.bodyMedium, { color: role.onSurface, marginTop: 6 }]}>"{dispute.details}"</Text> : null}
          {dispute.resolution ? <KV k="Resolution" v={titleCase(dispute.resolution)} /> : null}
          {(dispute.evidence || []).map((e: Row, i: number) => (
            <View key={i} style={{ marginTop: 12, gap: 6 }}>
              <Text style={[type.titleSmall, { color: role.onSurface }]}>
                {e.who} · {dateTime(e.created_at)}
              </Text>
              {e.note ? <Text style={[type.bodyMedium, { color: role.onSurface }]}>{e.note}</Text> : null}
              {e.media?.length ? <ImageGrid images={e.media.map((m: string, j: number) => ({ label: `${e.who} evidence ${j + 1}`, url: m }))} /> : null}
            </View>
          ))}
        </Card>
      ) : null}
      {proofs.length ? (
        <Card>
          <SectionTitle title="Handover proof" />
          {proofs.map((p) => (
            <View key={p.id} style={{ marginBottom: 12, gap: 6 }}>
              <Text style={[type.titleSmall, { color: role.onSurface }]}>
                {p.who} · {titleCase(p.stage)} · {dateTime(p.captured_at)}
              </Text>
              <Small>
                GPS {Number(p.lat).toFixed(5)}, {Number(p.lng).toFixed(5)} (±{Math.round(p.accuracy_m || 0)} m) · {p.source}
              </Small>
              {p.is_mock_location ? <Notice tone="bad" text="This phone reported a fake location." /> : null}
              <ImageGrid images={[{ label: `${p.who} selfie`, url: p.selfie_url }, ...(p.items || []).map((u: string, i: number) => ({ label: `Item ${i + 1}`, url: u }))]} />
            </View>
          ))}
        </Card>
      ) : null}
      {(s.events || []).length ? (
        <Card>
          <SectionTitle title="Timeline" />
          {s.events.map((e: Row, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
              <Small>{dateTime(e.created_at)}</Small>
              <Text style={[type.bodySmall, { color: role.onSurface, flex: 1 }]}>
                {titleCase(e.to_status)} ({e.actor_kind}){e.note ? ` · ${e.note}` : ''}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

export function SubjectView({ s, action }: { s: Row | null; action?: Row }) {
  if (!s) return <Notice tone="warn" text="The item this is about no longer exists." />;
  if (s.kind === 'kyc') {
    const k = s.kyc;
    const threshold = 0.8;
    return (
      <>
        <UserLine u={s.user} />
        <Card>
          <SectionTitle title={k.level === 'business' ? 'Business badge' : 'NID check'} right={<StatusPill status={k.status} map={kycLabel} />} />
          <KV k="Name (English)" v={k.name_en || '—'} strong />
          {k.name_bn ? <KV k="Name (Bangla)" v={k.name_bn} /> : null}
          {k.dob ? <KV k="Date of birth" v={String(k.dob).slice(0, 10)} /> : null}
          {k.nid_last4 ? <KV k="NID ends in" v={k.nid_last4} /> : null}
          {k.trade_licence_no ? <KV k="Trade licence" v={k.trade_licence_no} /> : null}
          {k.face_match != null ? <KV k="Face match" v={<Text style={{ color: k.face_match >= threshold ? accent.green : accent.red }}>{pct(k.face_match)}</Text>} /> : null}
          {k.liveness != null ? <KV k="Live selfie check" v={k.liveness ? 'Passed' : 'Failed'} /> : null}
          <KV k="Sent" v={dateTime(k.created_at)} />
        </Card>
        <Card>
          <SectionTitle title="Photos" />
          <Small>Compare the NID photo with both selfies, and the name with the payout account later.</Small>
          <View style={{ height: 10 }} />
          <ImageGrid images={s.images || []} />
        </Card>
      </>
    );
  }
  if (s.kind === 'deal') {
    return (
      <>
        <DealFacts d={s.deal} />
        {action?.payload?.buyer_paisa != null ? (
          <Card>
            <SectionTitle title="Proposed split" />
            <KV k="Buyer gets back" v={tk(action.payload.buyer_paisa)} strong />
            <KV k="Seller gets" v={tk(action.payload.seller_paisa)} strong />
          </Card>
        ) : null}
        <UserLine u={s.buyer} label="Buyer" />
        <UserLine u={s.seller} label="Seller" />
        <DealEvidence s={s} />
        <ListRow icon="document-text" title="Open full deal" sub="Chat, ledger and every action" onPress={() => router.push(`/admin/deal/${s.deal.id}`)} />
      </>
    );
  }
  if (s.kind === 'payout') {
    const p = s.payout;
    return (
      <>
        <UserLine u={s.user} />
        <Card>
          <SectionTitle title="Payout" />
          <KV k="Amount" v={tk(p.amount_paisa)} strong />
          <KV k="Method" v={titleCase(p.method)} />
          <KV k="Account" v={p.account_number} />
          <KV k="Name on account" v={p.account_name} />
          <KV k="Name on NID" v={p.kyc_name || 'Not verified'} />
          {p.deal_title ? <KV k="For deal" v={`${p.deal_title} (${titleCase(p.deal_status || '')})`} /> : null}
        </Card>
        {p.name_matches_kyc ? <Notice tone="ok" text="The account name matches the verified NID name." /> : <Notice tone="bad" text="The account name does not match the NID name. This payout can't be sent." />}
      </>
    );
  }
  if (s.kind === 'listing') {
    const l = s.listing;
    return (
      <>
        <UserLine u={s.user} label="Seller" />
        <Card>
          <SectionTitle title="Listing" right={<Tag text={titleCase(l.status)} color={accent.sky} />} />
          <KV k="Title" v={l.title} strong />
          <KV k="Price" v={tk(l.price_paisa)} />
          <KV k="Category" v={l.category} />
          {l.description ? <Text style={[type.bodyMedium, { color: role.onSurface, marginTop: 6 }]}>{l.description}</Text> : null}
        </Card>
        <Card>
          <ImageGrid images={s.images || []} />
        </Card>
      </>
    );
  }
  if (s.kind === 'profile') return <UserLine u={s.user} />;
  return null;
}

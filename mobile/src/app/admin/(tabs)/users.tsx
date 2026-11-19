import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { ListRow, roleLabel, useAdmin } from '../../../components/admin';
import { KycPill, Loader, Segmented, TrustPill } from '../../../components/bits';
import { Empty, ErrorText, Field, Page, Tag } from '../../../components/ui';
import { useLoad } from '../../../lib/hooks';
import { accent } from '../../../lib/theme';
import type { Row } from '../../../lib/types';

type F = 'all' | 'verified' | 'banned';

export default function Users() {
  const { api } = useAdmin();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<F>('all');
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.get<{ users: Row[] }>(`/api/admin/users?q=${encodeURIComponent(term)}&filter=${filter === 'all' ? '' : filter}`), [term, filter]);
  return (
    <Page inTabs refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} gap={10}>
      <View>
        <Field label="Search name, email or phone" value={q} onChangeText={setQ} autoCapitalize="none" returnKeyType="search" onSubmitEditing={() => setTerm(q.trim())} onBlur={() => setTerm(q.trim())} />
        <Segmented<F> value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'verified', label: 'Verified' }, { value: 'banned', label: 'Banned' }]} />
      </View>
      <ErrorText text={error} />
      {loading && !data ? (
        <Loader />
      ) : (data?.users || []).length ? (
        data!.users.map((u) => (
          <ListRow
            key={u.id}
            icon={u.is_banned ? 'no-symbol' : 'user'}
            color={u.is_banned ? accent.red : accent.sky}
            title={u.display_name}
            sub={[u.email, u.phone].filter(Boolean).join(' · ')}
            onPress={() => router.push(`/admin/user/${u.id}`)}
            badge={
              <>
                <TrustPill score={u.trust_score ?? 0} small />
                <KycPill level={u.kyc_level} />
                {u.is_banned ? <Tag text="Banned" color={accent.red} /> : null}
                {u.admin_role ? <Tag text={roleLabel[u.admin_role] || u.admin_role} color={accent.green} /> : null}
              </>
            }
          />
        ))
      ) : (
        <Empty icon="users" title="No users found" />
      )}
    </Page>
  );
}

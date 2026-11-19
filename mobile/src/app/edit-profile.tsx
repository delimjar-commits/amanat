import { useState } from 'react';
import { View } from 'react-native';
import { Notice, UserAvatar } from '../components/bits';
import { Button, Card, ErrorText, Field, Page } from '../components/ui';
import { useAction } from '../lib/hooks';
import { pickPhoto, upload } from '../lib/media';
import { useSession } from '../lib/session';

export default function EditProfile() {
  const { api, me, refreshMe } = useSession();
  const u = me?.user;
  const [name, setName] = useState(u?.display_name || '');
  const [area, setArea] = useState(u?.area || '');
  const [bio, setBio] = useState(u?.bio || '');
  const [ok, setOk] = useState(false);
  const act = useAction();
  if (!u) return null;
  return (
    <Page gap={14}>
      <Card>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <UserAvatar user={u} size={88} />
          <Button
            title="Change photo"
            small
            variant="ghost"
            icon="camera"
            loading={act.busy === 'a'}
            onPress={() =>
              act.run('a', async () => {
                const p = await pickPhoto('gallery');
                if (!p) return;
                const f = await upload(api, p, 'avatars');
                await api.patch('/api/me', { avatar_file: f.id });
                await refreshMe();
              })
            }
          />
        </View>
      </Card>
      <Card>
        <View style={{ gap: 12 }}>
          <Field label="Display name" value={name} onChangeText={setName} />
          <Field label="Area" placeholder="e.g. Mirpur, Dhaka" value={area} onChangeText={setArea} />
          <Field label="About you" value={bio} onChangeText={setBio} multiline style={{ minHeight: 90 }} />
        </View>
      </Card>
      <ErrorText text={act.error} />
      {ok ? <Notice tone="ok" text="Saved." /> : null}
      <Button
        title="Save"
        loading={act.busy === 's'}
        onPress={() =>
          act.run('s', async () => {
            await api.patch('/api/me', { display_name: name, area, bio });
            await refreshMe();
            setOk(true);
          })
        }
      />
    </Page>
  );
}

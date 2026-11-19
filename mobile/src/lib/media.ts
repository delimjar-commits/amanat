import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type { Api } from './api';

export type Picked = { uri: string; base64: string; mime: string; source: 'camera' | 'gallery' | 'web' };

/**
 * Take a photo (camera) or choose one (gallery). On the web there is no reliable camera
 * API in every browser, so the browser's file chooser is used and marked 'web'; the server
 * only rejects 'gallery' for live selfies and handover proofs.
 */
export async function pickPhoto(from: 'camera' | 'gallery', opts: { front?: boolean } = {}): Promise<Picked | null> {
  const base = { quality: 0.6, base64: true, allowsEditing: false, exif: false } as const;
  let r: ImagePicker.ImagePickerResult;
  if (from === 'camera' && Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Allow the camera to take this photo.');
    r = await ImagePicker.launchCameraAsync({
      ...base,
      mediaTypes: ['images'],
      cameraType: opts.front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    });
  } else {
    r = await ImagePicker.launchImageLibraryAsync({ ...base, mediaTypes: ['images'] });
  }
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  let b64 = a.base64 || '';
  let mime = a.mimeType || 'image/jpeg';
  if (!b64 && a.uri.startsWith('data:')) {
    mime = a.uri.slice(5, a.uri.indexOf(';')) || mime;
    b64 = a.uri.slice(a.uri.indexOf(',') + 1);
  }
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) mime = 'image/jpeg';
  const source = Platform.OS === 'web' ? 'web' : from;
  return { uri: a.uri, base64: b64, mime, source };
}

export async function upload(api: Api, p: Picked, bucket: string) {
  return api.post<{ id: string; url: string }>('/api/files', { bucket, mime: p.mime, data: p.base64, source: p.source });
}

export type Fix = { lat: number; lng: number; accuracy: number | null; is_mock: boolean };

export async function getFix(): Promise<Fix> {
  if (Platform.OS === 'web') {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (!nav?.geolocation) throw new Error('This browser cannot share your location.');
    return new Promise((resolve, reject) =>
      nav.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, is_mock: false }),
        () => reject(new Error('Allow location in your browser to continue.')),
        { enableHighAccuracy: true, timeout: 15000 },
      ),
    );
  }
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error('Allow location to continue.');
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, is_mock: Boolean((p as { mocked?: boolean }).mocked) };
}

import { type ComponentRef, useEffect, useRef, useState, type RefObject } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform, View } from 'react-native';

export type ViewHandle = ComponentRef<typeof View>;

/**
 * How many pixels of a view the software keyboard covers right now.
 *
 * Pad a screen's bottom by this number and its composer stays above the keyboard on
 * iOS, on Android (edge to edge, where the window no longer resizes), and in phone
 * browsers, where the keyboard shrinks only the visual viewport.
 *
 * Pass the ref of the view whose bottom edge should stay visible. Without one, the
 * view is taken to reach the bottom of the screen.
 */
export function useKeyboardInset(ref?: RefObject<ViewHandle | null>): number {
  const [inset, setInset] = useState(0);
  const last = useRef(0);

  useEffect(() => {
    const set = (n: number) => {
      const v = Math.max(0, Math.round(n));
      if (Math.abs(v - last.current) < 2) return;
      last.current = v;
      setInset(v);
    };

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const vv = window.visualViewport;
      if (!vv) return;
      const onChange = () => {
        // iOS Safari scrolls the whole page when a field takes focus; pin it back so the
        // padded layout is what the person sees.
        if (window.scrollY !== 0 && document.body.style.overflow !== 'auto') window.scrollTo(0, 0);
        const keyboardTop = vv.height + vv.offsetTop;
        let bottom = window.innerHeight;
        const node = ref?.current as unknown as HTMLElement | null;
        if (node && typeof node.getBoundingClientRect === 'function') bottom = node.getBoundingClientRect().bottom;
        // A gap under ~80px is browser chrome (the URL bar), not a keyboard.
        const covered = bottom - keyboardTop;
        set(covered > 80 ? covered : 0);
      };
      vv.addEventListener('resize', onChange);
      vv.addEventListener('scroll', onChange);
      onChange();
      return () => {
        vv.removeEventListener('resize', onChange);
        vv.removeEventListener('scroll', onChange);
      };
    }

    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const frameEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidChangeFrame';
    const onShow = (e: { endCoordinates: { screenY: number; height: number }; duration?: number }) => {
      const keyboardTop = e.endCoordinates.screenY || Dimensions.get('screen').height - e.endCoordinates.height;
      const apply = (viewBottom: number) => {
        if (Platform.OS === 'ios' && e.duration) {
          LayoutAnimation.configureNext({ duration: e.duration, update: { type: 'keyboard' } });
        }
        set(viewBottom - keyboardTop);
      };
      const node = ref?.current;
      if (node && typeof node.measureInWindow === 'function') {
        node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
          // Padding sits inside the view, so its outer bottom edge does not move with it.
          const bottom = y + h;
          // If the window already shrank for the keyboard (an older Android resize
          // mode), the view ends above the keyboard and nothing needs padding.
          apply(Number.isFinite(bottom) && bottom > 0 ? bottom : Dimensions.get('window').height);
        });
      } else {
        apply(Dimensions.get('window').height);
      }
    };
    const onHide = (e?: { duration?: number }) => {
      if (Platform.OS === 'ios' && e?.duration) LayoutAnimation.configureNext({ duration: e.duration, update: { type: 'keyboard' } });
      set(0);
    };
    const subs = [
      Keyboard.addListener(showEvt, onShow),
      Keyboard.addListener(frameEvt, (e) => (e.endCoordinates.height > 0 && Keyboard.isVisible() ? onShow(e) : undefined)),
      Keyboard.addListener(hideEvt, onHide),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [ref]);

  return inset;
}

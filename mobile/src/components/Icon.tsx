import Svg, { Path } from 'react-native-svg';
import { HERO_PATHS, type HeroName } from './heroPaths';

// Heroicons outline, 1.5 stroke, drawn with currentColor = color.
export function Icon({ name, size = 24, color, strokeWidth = 1.5 }: { name: HeroName; size?: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {HERO_PATHS[name].map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

export type { HeroName };

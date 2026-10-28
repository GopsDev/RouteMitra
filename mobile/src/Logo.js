// The RouteMitra mark: a teal pin with a little route inside.

import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from './theme';

export default function Logo({ size = 30 }) {
  return (
    <Svg width={size * 0.8} height={size} viewBox="0 0 32 40">
      <Path d="M16 1C7.7 1 1 7.6 1 15.8 1 26.6 16 39 16 39s15-12.4 15-23.2C31 7.6 24.3 1 16 1Z" fill={colors.primary} />
      <Circle cx="16" cy="15.5" r="9.5" fill="#ffffff" />
      <Path d="M10.5 20.5c1.6-3.4 3.4-1.8 5-4.8s3.6-1.6 5.6-5.2" fill="none" stroke={colors.primary} strokeWidth={2.4} strokeLinecap="round" />
      <Circle cx="10.5" cy="20.5" r="1.8" fill={colors.primary} />
      <Circle cx="21.1" cy="10.5" r="1.8" fill={colors.primary} />
    </Svg>
  );
}

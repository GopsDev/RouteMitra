// Line icons, the same shapes as the web page.

import Svg, { Circle, Path, Rect } from 'react-native-svg';

const shapes = {
  navigate: [<Path key="a" d="m3 11 18-8-8 18-2-8-8-2Z" />],
  pin: [<Path key="a" d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12Z" />, <Circle key="b" cx="12" cy="9" r="2.5" />],
  check: [<Path key="a" d="M20 6 9 17l-5-5" />],
  flag: [<Path key="a" d="M5 21V4h11l-1 4 1 4H5" />],
  camera: [<Path key="a" d="M4 8h3l2-3h6l2 3h3v11H4Z" />, <Circle key="b" cx="12" cy="13" r="3.5" />],
  logout: [<Path key="a" d="M9 3H5v18h4M14 17l5-5-5-5M19 12H8" />],
  route: [<Circle key="a" cx="5" cy="17" r="2" />, <Circle key="b" cx="19" cy="7" r="2" />, <Path key="c" d="M6.5 15.5 10 11l4 3 3.5-5.5" />],
  bell: [<Path key="a" d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />],
  close: [<Path key="a" d="M18 6 6 18M6 6l12 12" />],
  shield: [<Path key="a" d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />, <Path key="b" d="m8.5 12 2.5 2.5 4.5-5" />],
  refresh: [<Path key="a" d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />],
  skip: [<Path key="a" d="M5 5l10 7-10 7V5ZM19 5v14" />],
  home: [<Path key="a" d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12Z" />, <Circle key="b" cx="12" cy="9" r="2.5" />],
  checkins: [<Rect key="a" x="5" y="4" width="14" height="17" rx="2" />, <Path key="b" d="M9 3h6v3H9zM9 11h6M9 15h6" />],
  profile: [<Circle key="a" cx="12" cy="8" r="4" />, <Path key="b" d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />],
  crosshair: [<Circle key="a" cx="12" cy="12" r="7" />, <Path key="b" d="M12 2v4M12 18v4M2 12h4M18 12h4" />],
};

export default function Icon({ name, size = 22, color = '#0f1d2e', width = 2 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {shapes[name]}
    </Svg>
  );
}

// Colours and shared styles. Same teal look as the /routemitra web page.

export const colors = {
  bg: '#f3f5f7',
  card: '#ffffff',
  text: '#0f1d2e',
  muted: '#5b6676',
  border: '#e3e7ec',
  primary: '#0e7c80',
  primaryDark: '#0a6366',
  primarySoft: '#d9f0f0',
  route: '#2563eb',
  green: '#15803d',
  greenDot: '#22a35a',
  greenBg: '#dcf3e4',
  orange: '#a35a00',
  orangeDot: '#f0a030',
  orangeBg: '#fdebcf',
  red: '#b42318',
  redDot: '#e5484d',
  redBg: '#fde3e0',
  gray: '#9aa4b1',
  grayBg: '#eceff3',
  checksBg: '#c9e7e8',
};

export const shadow = {
  shadowColor: '#0f1d2e',
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

// Background and text colour for each chip tone.
export const tones = {
  teal: [colors.primarySoft, colors.primaryDark],
  green: [colors.greenBg, colors.green],
  orange: [colors.orangeBg, colors.orange],
  red: [colors.redBg, colors.red],
  '': [colors.grayBg, colors.muted],
};

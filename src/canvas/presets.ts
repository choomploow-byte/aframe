/** Frame size presets (docs/07 "Frame presets popover"). */
export interface DevicePreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: 'desktop', label: 'Desktop', w: 1440, h: 900 },
  { id: 'laptop', label: 'Laptop', w: 1280, h: 800 },
  { id: 'tablet', label: 'Tablet', w: 820, h: 1180 },
  { id: 'mobile', label: 'Mobile', w: 390, h: 844 },
];

import { CarFront, ChartNoAxesColumnIncreasing, ClipboardList, Fuel, House } from 'lucide-react';

export type { WorkspaceScreen as Page } from '@/lib/navigation/garage-routes';

// Service keeps the base accent; the other areas carry their own hue.
export const navigation = [
  { id: 'dashboard', icon: House, tone: '' },
  { id: 'cars', icon: CarFront, tone: 'tone-vehicle' },
  { id: 'fuel', icon: Fuel, tone: 'tone-fuel' },
  { id: 'history', icon: ClipboardList, tone: '' },
  { id: 'reports', icon: ChartNoAxesColumnIncreasing, tone: 'tone-spend' },
] as const;

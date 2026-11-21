import {
  CarFront,
  ChartNoAxesColumnIncreasing,
  ClipboardList,
  Fuel,
  House,
  Wallet,
} from 'lucide-react';

export type { WorkspaceScreen as Page } from '@/lib/navigation/garage-routes';

// Service keeps the base accent; the other areas carry their own hue.
export const navigation = [
  { id: 'dashboard', icon: House, tone: 'tone-home' },
  { id: 'cars', icon: CarFront, tone: 'tone-vehicle' },
  { id: 'fuel', icon: Fuel, tone: 'tone-fuel' },
  { id: 'history', icon: ClipboardList, tone: '' },
  { id: 'costs', icon: Wallet, tone: 'tone-spend' },
  { id: 'reports', icon: ChartNoAxesColumnIncreasing, tone: 'tone-spend' },
] as const;

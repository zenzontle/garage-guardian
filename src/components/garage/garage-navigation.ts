import { CarFront, ChartNoAxesColumnIncreasing, ClipboardList, Fuel, House } from 'lucide-react';

export type { WorkspaceScreen as Page } from '@/lib/navigation/garage-routes';

export const navigation = [
  { id: 'dashboard', icon: House },
  { id: 'cars', icon: CarFront },
  { id: 'history', icon: ClipboardList },
  { id: 'fuel', icon: Fuel },
  { id: 'reports', icon: ChartNoAxesColumnIncreasing },
] as const;

import { CarFront, ChartNoAxesColumnIncreasing, ClipboardList, House } from 'lucide-react';

export type { WorkspaceScreen as Page } from '@/lib/garage-routes';

export const navigation = [
  { id: 'dashboard', icon: House },
  { id: 'cars', icon: CarFront },
  { id: 'history', icon: ClipboardList },
  { id: 'reports', icon: ChartNoAxesColumnIncreasing },
] as const;

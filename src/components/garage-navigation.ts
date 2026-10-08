import { CarFront, ClipboardList, DollarSign, LayoutDashboard } from 'lucide-react';

export type { WorkspaceScreen as Page } from '@/lib/garage-routes';

export const navigation = [
  { id: 'dashboard', icon: LayoutDashboard },
  { id: 'cars', icon: CarFront },
  { id: 'history', icon: ClipboardList },
  { id: 'reports', icon: DollarSign },
] as const;

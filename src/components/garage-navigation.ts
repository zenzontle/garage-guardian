import { CarFront, ClipboardList, DollarSign, LayoutDashboard } from 'lucide-react';

export type Page = 'dashboard' | 'cars' | 'history' | 'reports';

export const navigation = [
  { id: 'dashboard', icon: LayoutDashboard },
  { id: 'cars', icon: CarFront },
  { id: 'history', icon: ClipboardList },
  { id: 'reports', icon: DollarSign },
] as const;

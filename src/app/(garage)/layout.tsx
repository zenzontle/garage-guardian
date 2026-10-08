import type { ReactNode } from 'react';
import { GarageApp } from '@/components/garage-app';

export default function GarageLayout({ children }: { children: ReactNode }) {
  return <GarageApp>{children}</GarageApp>;
}

'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { getAllDue } from '@/lib/due';
import { useGarageSession } from '@/lib/use-garage-session';
import type { Car, ScheduleItem, Visit } from '@/lib/model';
import { accountMode } from '@/lib/garage-routes';
import { todayISO } from '@/lib/today-iso';

type ModalState =
  | { kind: 'car'; item?: Car }
  | { kind: 'schedule'; item?: ScheduleItem; carId: string }
  | { kind: 'visit'; item?: Visit; carId?: string }
  | null;

function useGarageState() {
  const garage = useGarageSession();
  const pathname = usePathname();
  const currentPath = useRef(pathname);
  currentPath.current = pathname;
  const [modal, setModal] = useState<ModalState>(null);
  const [notice, setNotice] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountEmail, setAccountEmail] = useState('');

  useEffect(() => {
    setModal(null);
    setMenuOpen(false);
    if (!accountMode(pathname)) setAccountEmail('');
  }, [pathname]);
  useEffect(() => {
    if (garage.loading) setModal(null);
    if (garage.user) setNotice(false);
  }, [garage.loading, garage.user]);

  const allDue = useMemo(
    () =>
      getAllDue(
        garage.snapshot.cars,
        garage.snapshot.schedules,
        garage.snapshot.visits,
        todayISO(),
      ),
    [garage.snapshot],
  );
  const visits = useMemo(
    () =>
      [...garage.snapshot.visits].sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
      ),
    [garage.snapshot.visits],
  );

  async function perform(action: () => Promise<void>) {
    const result = await garage.run(action);
    setModal(null);
    return result;
  }

  return {
    ...garage,
    currentPath,
    allDue,
    visits,
    modal,
    setModal,
    notice,
    setNotice,
    menuOpen,
    setMenuOpen,
    accountEmail,
    setAccountEmail,
    perform,
  };
}

const GarageContext = createContext<ReturnType<typeof useGarageState> | null>(null);

export function GarageProvider({ children }: { children: ReactNode }) {
  const garage = useGarageState();
  return <GarageContext.Provider value={garage}>{children}</GarageContext.Provider>;
}

export function useGarage() {
  const garage = useContext(GarageContext);
  if (!garage) throw new Error('GarageProvider is required');
  return garage;
}

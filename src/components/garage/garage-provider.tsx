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
import { getAllDue } from '@/lib/maintenance/due';
import { useGarageSession } from '@/lib/garage/use-garage-session';
import { currencyOrDefault } from '@/lib/currency/currency';
import { useBackgroundConversions } from '@/lib/currency/use-background-conversions';
import type { Car, ScheduleItem, Visit } from '@/lib/garage/model';
import { todayISO } from '@/lib/utils/today-iso';
import { useInteractions } from '../interaction/interaction-provider';
import { useFormInteraction } from '../interaction/use-form-interaction';

type ModalState =
  | { kind: 'car'; item?: Car }
  | { kind: 'schedule'; item?: ScheduleItem; carId: string }
  | { kind: 'visit'; item?: Visit; carId?: string }
  | { kind: 'account'; section?: 'security' }
  | null;

function useGarageState() {
  const garage = useGarageSession();
  const homeCurrency = currencyOrDefault(garage.snapshot.homeCurrency);
  const conversions = useBackgroundConversions(
    garage.repository,
    garage.snapshot.visits,
    homeCurrency,
    garage.refreshConversions,
  );
  const refreshConversions = garage.refreshConversions;
  useEffect(() => {
    const online = () => {
      void refreshConversions();
    };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [refreshConversions]);
  useFormInteraction(null, { busy: garage.transferring && garage.loading });
  const interactions = useInteractions();
  const pathname = usePathname();
  const currentPath = useRef(pathname);
  currentPath.current = pathname;
  const [modal, setModal] = useState<ModalState>(null);
  const [notice, setNotice] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountEmail, setAccountEmail] = useState('');
  const identity = garage.user?.id;
  useEffect(() => {
    interactions?.clear();
  }, [identity, garage.recovering, interactions]);

  useEffect(() => {
    setModal(null);
    setMenuOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (garage.loading) setModal((previous) => (previous?.kind === 'account' ? previous : null));
    if (garage.user) {
      setNotice(false);
      setAccountEmail('');
    }
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
    homeCurrency,
    conversions,
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
    signOut: (onStarted?: () => void) => {
      const action = () => {
        onStarted?.();
        void garage.signOut();
      };
      if (interactions) interactions.request(action);
      else action();
    },
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

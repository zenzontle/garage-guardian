"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDownToLine, ArrowRight, CalendarDays, CarFront, Check, ChevronDown, CircleAlert,
  ClipboardList, DollarSign, Gauge, LayoutDashboard, LogOut, Menu, Plus, Search,
  Settings2, Trash2, Wrench, X,
} from "lucide-react";
import { getAllDue, latestOdometer, type DueItem } from "@/lib/due";
import { isCloudConfigured, type Repository } from "@/lib/repository";
import { useGarageSession } from "@/lib/use-garage-session";
import { normalizePlate, PLATE_MAX_LENGTH, defaultReminderDistance, distanceInMiles, distanceUnitOrDefault, makeStarterSchedules, newId, type Car, type DistanceUnit, type ScheduleItem, type Visit, type VisitItem, type Photo } from "@/lib/model";
import { reportTotals, visitsToCsv } from "@/lib/reports";
import { MoneyInput } from "./money-input";
import { GarageLogo } from "./garage-logo";
import { EditableCombobox } from "./editable-combobox";
import { useVehicleCatalog } from "@/lib/use-vehicle-catalog";
import { normalizeVehicleKey } from "@/lib/vehicle-catalog";
import { BugReporter } from "./bug-reporter";

import { LocaleProvider, LocaleSelector } from './locale-provider';
import { useDisplay } from '@/i18n/use-display';
import { AppError, failureOf, type AppFailure } from '@/lib/app-error';

type Page = "dashboard" | "cars" | "history" | "reports";
type ModalState = { kind: "car"; item?: Car } | { kind: "schedule"; item?: ScheduleItem; carId: string } | { kind: "visit"; item?: Visit; carId?: string } | null;

const navigation = [
  { id: "dashboard", icon: LayoutDashboard },
  { id: "cars", icon: CarFront },
  { id: "history", icon: ClipboardList },
  { id: "reports", icon: DollarSign },
] as const;
const todayISO = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

export function GarageApp() {
  return <LocaleProvider><GarageContent /></LocaleProvider>;
}

function GarageContent() {
  const t = useTranslations();
  const { displayDate } = useDisplay();
  const garage = useGarageSession();
  const { repository, snapshot, user, loading, transferring, error, setError } = garage;
  const [page, setPage] = useState<Page>("dashboard");
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedCarId, setSelectedCarId] = useState<string>("");
  const [authView, setAuthView] = useState<"signin" | "signup" | null>(null);
  const [notice, setNotice] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (loading) { setModal(null); setSelectedCarId(""); }
    if (user) { setAuthView(null); setNotice(false); }
  }, [loading, user]);

  async function perform(action: () => Promise<void>) {
    await garage.run(action);
    setModal(null);
  }

  const allDue = useMemo(() => getAllDue(snapshot.cars, snapshot.schedules, snapshot.visits, todayISO()), [snapshot]);
  const visits = useMemo(() => [...snapshot.visits].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [snapshot.visits]);
  const selectedCar = snapshot.cars.find((car) => car.id === selectedCarId) ?? null;
  const reporter = <BugReporter key={user?.id ?? 'guest'} userId={user?.id} screen={loading ? 'loading' : !repository ? 'recovery' : page} dialog={modal?.kind === 'car' ? modal.item ? 'edit-car' : 'add-car' : modal?.kind ?? 'none'} />;

  const accountActions = user
    ? <button className="button secondary" onClick={() => void garage.signOut()}><LogOut size={17} />{t('account.signOut')}</button>
    : isCloudConfigured && <div className="account-actions"><button className="button secondary" onClick={() => setAuthView("signin")}>{t('account.signIn')}</button><button className="button primary" onClick={() => setAuthView("signup")}>{t('account.create')}</button></div>;

  if (loading || !repository) return <>{reporter}<div className="auth-page"><div className="auth-card">{!loading && <LocaleSelector />}<h1>{transferring ? t('app.moving') : t('app.opening')}</h1>{loading ? <p role="status">{transferring ? t('app.uploading') : t('app.loading')}</p> : <><p className="error-text" role="alert">{error ? t(`errors.${error.code}`, error.values) : t("errors.load")}</p><button className="button primary" onClick={garage.retry}>{t('shared.retry')}</button></>}{user && <div className="recovery-actions">{accountActions}</div>}</div></div></>;
  if (authView && !user) return <AccountForm mode={authView} onMode={setAuthView} onClose={() => setAuthView(null)} onSubmit={async (email, password) => {
    if (authView === "signup") {
      const confirmation = await garage.signUp(email, password);
      if (confirmation) setNotice(true);
    } else await garage.signIn(email, password);
    setAuthView(null);
  }} />;

  return <>{reporter}<div className="app-shell">
    <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><GarageLogo /></div><div><strong>Garage Guardian</strong><small>{t('app.tagline')}</small></div></div>
      <div className="sidebar-label">{t('app.workspace')}</div>
      <nav aria-label={t('app.mainNavigation')}>
        {navigation.map(({ id, icon: Icon }) => <button key={id} className={`nav-link ${page === id ? "active" : ""}`} onClick={() => { setPage(id); setMenuOpen(false); }}><Icon size={19} /><span>{t(`navigation.${id}`)}</span>{page === id && <span className="nav-indicator" />}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-summary"><span className="summary-icon"><CarFront size={18} /></span><div><strong>{t('app.vehicleCount', { count: snapshot.cars.length })}</strong><small>{t('app.inGarage')}</small></div></div>
        <div className="account-line"><span className="avatar">{user?.email ? user.email[0].toUpperCase() : "G"}</span><span className="account-text"><strong>{user?.email || (isCloudConfigured ? t('app.guest') : t('app.prototype'))}</strong><small>{user ? t('app.cloudStorage') : t('app.localStorage')}</small></span></div>
      </div>
    </aside>

    <div className="main-wrap">
      <header className="topbar"><button className="mobile-menu icon-button" aria-label={t('app.openMenu')} onClick={() => setMenuOpen(!menuOpen)}><Menu size={22} /></button><span className="breadcrumbs">{t('app.yourGarage')}<span>/</span> <strong>{t(`navigation.${page}`)}</strong></span><span className="topbar-right"><LocaleSelector /><span className="today-pill"><CalendarDays size={15} />{displayDate(todayISO())}</span></span></header>
      <main className="content">
        {isCloudConfigured && <div className="storage-account"><span>{user ? t('app.cloudStorage') : t('app.guestStorage')}</span>{accountActions}</div>}
        {notice && <div className="demo-banner" role="status">{t('account.confirmation')}</div>}
        {error && <div className="error-banner" role="alert"><CircleAlert size={18} />{t(`errors.${error.code}`, error.values)}<button aria-label={t('app.dismissError')} onClick={() => setError(null)}><X size={16} /></button></div>}
        {!isCloudConfigured && <div className="demo-banner"><CircleAlert size={17} /><span>{t('app.prototypeNotice')}</span></div>}
        {page === "dashboard" && <Dashboard cars={snapshot.cars} visits={visits} allDue={allDue} onAddCar={() => setModal({ kind: "car" })} onAddVisit={() => setModal({ kind: "visit" })} onViewCar={(id) => { setSelectedCarId(id); setPage("cars"); }} onViewAll={() => setPage("history")} />}
        {page === "cars" && <CarsPage cars={snapshot.cars} schedules={snapshot.schedules} visits={visits} allDue={allDue} selectedCar={selectedCar} onSelect={setSelectedCarId} onAdd={() => setModal({ kind: "car" })} onEdit={(item) => setModal({ kind: "car", item })} onAddSchedule={(carId) => setModal({ kind: "schedule", carId })} onEditSchedule={(item) => setModal({ kind: "schedule", carId: item.carId, item })} onAddVisit={(carId) => setModal({ kind: "visit", carId })} onDeleteCar={async (car) => { if (confirm(t('car.confirmDelete', { name: car.name }))) await perform(() => repository!.deleteCar(car.id)); }} onDeleteSchedule={async (item) => { if (confirm(t('car.confirmDeleteTask', { name: item.name }))) await perform(() => repository!.deleteSchedule(item.id)); }} />}
        {page === "history" && <HistoryPage cars={snapshot.cars} visits={visits} repository={repository!} onAdd={() => setModal({ kind: "visit" })} onEdit={(item) => setModal({ kind: "visit", item })} onDelete={async (visit) => { if (confirm(t('history.confirmDelete'))) await perform(() => repository!.deleteVisit(visit)); }} />}
        {page === "reports" && <ReportsPage cars={snapshot.cars} visits={visits} />}
      </main>
    </div>

    <nav className="mobile-tabs" aria-label={t('app.mobileNavigation')}>{navigation.map(({ id, icon: Icon }) => <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}><Icon size={20} /><span>{id === 'history' ? t('navigation.historyShort') : t(`navigation.${id}`)}</span></button>)}</nav>

    {modal?.kind === "car" && <CarModal item={modal.item} onClose={() => setModal(null)} onSave={async (car, starter) => { await perform(async () => { await repository!.saveCar(car); if (starter) for (const item of makeStarterSchedules(car.id, [t('starter.oil'), t('starter.rotation'), t('starter.tires'), t('starter.engineFilter'), t('starter.cabinFilter'), t('starter.service')])) await repository!.saveSchedule(item); }); setSelectedCarId(car.id); setPage("cars"); }} />}
    {modal?.kind === "schedule" && <ScheduleModal item={modal.item} carId={modal.carId} distanceUnit={snapshot.cars.find((car) => car.id === modal.carId)?.distanceUnit ?? "miles"} onClose={() => setModal(null)} onSave={async (item) => perform(() => repository!.saveSchedule(item))} />}
    {modal?.kind === "visit" && <VisitModal item={modal.item} carId={modal.carId} cars={snapshot.cars} visits={visits} schedules={snapshot.schedules} repository={repository!} onClose={() => setModal(null)} onSave={async (item) => perform(() => repository!.saveVisit(item))} />}
  </div></>;
}



function AccountForm({ mode, onMode, onClose, onSubmit }: { mode: "signin" | "signup"; onMode: (mode: "signin" | "signup") => void; onClose: () => void; onSubmit: (email: string, password: string) => Promise<void> }) {
  const t = useTranslations();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppFailure | null>(null);
  const signup = mode === "signup";
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await onSubmit(email.trim(), password); }
    catch (cause) { setError(failureOf(cause, 'auth')); }
    finally { setBusy(false); }
  }
  return <div className="auth-page"><div className="auth-card"><LocaleSelector /><div className="brand"><div className="brand-mark"><GarageLogo /></div><div><strong>Garage Guardian</strong><small>{t('app.tagline')}</small></div></div><h1>{signup ? t('account.createTitle') : t('account.welcome')}</h1><p>{signup ? t('account.signupDescription') : t('account.signinDescription')}</p>{error && <div className="error-banner" role="alert">{t(`errors.${error.code}`, error.values)}</div>}<form onSubmit={submit} className="form-stack"><label>{t('account.email')}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label><label>{t('account.password')}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={signup ? 6 : undefined} autoComplete={signup ? "new-password" : "current-password"} /></label><button className="button primary full" disabled={busy}>{busy ? t('account.wait') : signup ? t('account.create') : t('account.signIn')}<ArrowRight size={17} /></button><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t('account.continueGuest')}</button><button type="button" className="text-link" disabled={busy} onClick={() => { setError(null); setPassword(""); onMode(signup ? "signin" : "signup"); }}>{signup ? t('account.existingAccount') : t('account.createLink')}</button></form></div></div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {

return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}

function Dashboard({ cars, visits, allDue, onAddCar, onAddVisit, onViewCar, onViewAll }: { cars: Car[]; visits: Visit[]; allDue: DueItem[]; onAddCar: () => void; onAddVisit: () => void; onViewCar: (id: string) => void; onViewAll: () => void }) {
  const t = useTranslations();
  const { number, money, displayDate, formatDistance } = useDisplay();
  const due = allDue.filter((item) => item.status === "due");
  const upcoming = allDue.filter((item) => item.status === "upcoming");
  const spendThisYear = visits.filter((visit) => visit.date.startsWith(String(new Date().getFullYear()))).reduce((sum, visit) => sum + visit.totalCostCents, 0);
  return <>
    <PageHeading eyebrow={t('dashboard.overview')} title={t('dashboard.title')} description={t('dashboard.description')} action={<button className="button primary" onClick={cars.length ? onAddVisit : onAddCar}><Plus size={18} />{cars.length ? t('shared.logService') : t('dashboard.firstCar')}</button>} />
    {cars.length === 0 ? <div className="empty-hero"><div className="empty-illustration"><CarFront size={55} strokeWidth={1.5} /></div><h2>{t('dashboard.emptyTitle')}</h2><p>{t('dashboard.emptyDescription')}</p><button className="button primary" onClick={onAddCar}><Plus size={18} />{t('shared.addCar')}</button></div> : <>
      <div className="stat-grid"><Stat icon={<CarFront size={20} />} label={t('dashboard.vehicles')} value={number(cars.length)} detail={t('app.inGarage')} /><Stat icon={<CircleAlert size={20} />} label={t('shared.dueNow')} value={number(due.length)} detail={t('dashboard.attentionItems', { count: due.length })} accent={due.length > 0} /><Stat icon={<CalendarDays size={20} />} label={t('shared.comingUp')} value={number(upcoming.length)} detail={t('dashboard.reminderWindows')} /><Stat icon={<DollarSign size={20} />} label={t('dashboard.yearSpend')} value={money(spendThisYear)} detail={t('dashboard.allVehicles')} /></div>
      <div className="dashboard-grid"><section className="panel attention-panel"><div className="section-heading"><div><span className="eyebrow">{t('dashboard.maintenance')}</span><h2>{t('dashboard.attention')}</h2></div><span className="count-badge">{number(due.length + upcoming.length)}</span></div>{due.length + upcoming.length ? <div className="due-list">{[...due, ...upcoming].slice(0, 6).map((item) => <DueRow key={item.schedule.id} item={item} onClick={() => onViewCar(item.car.id)} />)}</div> : <div className="panel-empty"><Check size={21} /><div><strong>{t('dashboard.caughtUp')}</strong><p>{t('dashboard.noDue')}</p></div></div>}{allDue.some((item) => item.status === "setup") && <div className="setup-note"><Settings2 size={16} />{t('dashboard.setupNote')}</div>}</section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">{t('dashboard.yourVehicles')}</span><h2>{t('dashboard.inGarage')}</h2></div></div><div className="vehicle-list">{cars.map((car) => { const count = allDue.filter((item) => item.car.id === car.id && item.status === "due").length; return <button className="vehicle-row" key={car.id} onClick={() => onViewCar(car.id)}><span className="vehicle-icon"><CarFront size={22} /></span><span><strong>{car.name}</strong><small>{car.year} {car.make} {car.model} · {formatDistance(latestOdometer(car, visits), car.distanceUnit)}</small></span>{count > 0 && <span className="tiny-alert">{t('dashboard.dueCount', { count })}</span>}<ArrowRight size={17} /></button>; })}</div><button className="text-link" onClick={onAddCar}><Plus size={16} /> {t('dashboard.addAnother')}</button></section></div>
      <section className="panel recent-panel"><div className="section-heading"><div><span className="eyebrow">{t('dashboard.activity')}</span><h2>{t('dashboard.recent')}</h2></div><button className="text-link" onClick={onViewAll}>{t('dashboard.viewAll')}<ArrowRight size={16} /></button></div>{visits.length ? <div className="recent-list">{visits.slice(0, 5).map((visit) => <div className="recent-row" key={visit.id}><span className="service-icon"><Wrench size={18} /></span><span className="recent-main"><strong>{visit.items.map((item) => item.name).join(", ") || t('shared.serviceVisit')}</strong><small>{cars.find((car) => car.id === visit.carId)?.name} · {displayDate(visit.date)}</small></span><strong>{money(visit.totalCostCents)}</strong></div>)}</div> : <div className="panel-empty"><Wrench size={20} /><div><strong>{t('dashboard.noVisits')}</strong><p>{t('dashboard.historyPlaceholder')}</p></div></div>}</section>
    </>}
  </>;
}

function Stat({ icon, label, value, detail, accent = false }: { icon: ReactNode; label: string; value: string; detail: string; accent?: boolean }) {

return <div className={`stat-card ${accent ? "alert" : ""}`}><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span></div><strong>{value}</strong><small>{detail}</small></div>;
}

function DueRow({ item, onClick }: { item: DueItem; onClick?: () => void }) {
  const t = useTranslations();
  const { dueDescription } = useDisplay();
  const content = <><span className={`status-dot ${item.status}`} /><span className="due-main"><strong>{item.schedule.name}</strong><small>{item.car.name} · {dueDescription(item)}</small></span><span className={`status-pill ${item.status}`}>{item.status === "due" ? t('shared.dueNow') : item.status === "upcoming" ? t('shared.comingUp') : item.status === "setup" ? t('shared.setup') : item.status === "completed" ? t('shared.done') : t('shared.later')}</span></>;
  return onClick ? <button className="due-row" onClick={onClick}>{content}<ArrowRight size={16} /></button> : <div className="due-row">{content}</div>;
}

function CarsPage({ cars, schedules, visits, allDue, selectedCar, onSelect, onAdd, onEdit, onAddSchedule, onEditSchedule, onAddVisit, onDeleteCar, onDeleteSchedule }: { cars: Car[]; schedules: ScheduleItem[]; visits: Visit[]; allDue: DueItem[]; selectedCar: Car | null; onSelect: (id: string) => void; onAdd: () => void; onEdit: (car: Car) => void; onAddSchedule: (carId: string) => void; onEditSchedule: (item: ScheduleItem) => void; onAddVisit: (carId: string) => void; onDeleteCar: (car: Car) => void; onDeleteSchedule: (item: ScheduleItem) => void }) {
  const t = useTranslations();
  const { number, money, displayDate, formatDistance, dueDescription } = useDisplay();
  const car = selectedCar ?? cars[0];
  const carDue = car ? allDue.filter((item) => item.car.id === car.id) : [];
  const carVisits = car ? visits.filter((visit) => visit.carId === car.id) : [];
  return <><PageHeading eyebrow={t('dashboard.yourVehicles')} title={t('navigation.cars')} description={t('car.description')} action={<button className="button primary" onClick={onAdd}><Plus size={18} />{t('shared.addCar')}</button>} />
    {cars.length === 0 ? <EmptyPanel icon={<CarFront size={25} />} title={t('car.emptyTitle')} description={t('car.emptyDescription')} action={<button className="button primary" onClick={onAdd}>{t('shared.addCar')}</button>} /> : <>
      <div className="car-switcher" role="tablist" aria-label={t('car.choose')}>{cars.map((item) => <button role="tab" aria-selected={car.id === item.id} className={`car-tab ${car.id === item.id ? "active" : ""}`} key={item.id} onClick={() => onSelect(item.id)}><CarFront size={19} /><span>{item.name}</span></button>)}</div>
      <div className="car-header panel"><div className="car-header-icon"><CarFront size={30} /></div><div className="car-header-copy"><span className="eyebrow">{car.year} {car.make.toUpperCase()} {car.model.toUpperCase()}</span><h2>{car.name}</h2><p><Gauge size={16} /> {formatDistance(latestOdometer(car, visits), car.distanceUnit)} {t('car.currentOdometer')}{car.vin && ` · VIN ${car.vin}`}</p>{car.plate && <p className="car-plate">{t('car.plate', { plate: car.plate })}</p>}</div><div className="car-header-actions"><button className="button secondary" onClick={() => onEdit({ ...car, odometer: latestOdometer(car, visits) })}><Settings2 size={16} />{t('car.edit')}</button><button className="button primary" onClick={() => onAddVisit(car.id)}><Plus size={17} />{t('shared.logService')}</button></div></div>
      <div className="car-content-grid"><section className="panel"><div className="section-heading"><div><span className="eyebrow">{t('car.servicePlan')}</span><h2>{t('car.maintenanceSchedule')}</h2></div><button className="text-link" onClick={() => onAddSchedule(car.id)}><Plus size={16} />{t('car.addTask')}</button></div><p className="section-hint">{t('car.scheduleHint')}</p><div className="schedule-list">{carDue.map((due) => <div className="schedule-row" key={due.schedule.id}><span className={`status-dot ${due.status}`} /><div className="schedule-main"><strong>{due.schedule.name}</strong><small>{dueDescription(due)}</small>{due.schedule.sourceNote && <small>{t('car.source', { source: due.schedule.sourceNote })}</small>}</div><span className={`status-pill ${due.status}`}>{due.status === "due" ? t('car.due') : due.status === "upcoming" ? t('car.soon') : due.status === "setup" ? t('shared.setup') : due.status === "completed" ? t('shared.done') : t('shared.later')}</span><button className="icon-button" aria-label={t('shared.editNamed', { name: due.schedule.name })} onClick={() => onEditSchedule(due.schedule)}><Settings2 size={16} /></button><button className="icon-button danger" aria-label={t('shared.deleteNamed', { name: due.schedule.name })} onClick={() => onDeleteSchedule(due.schedule)}><Trash2 size={16} /></button></div>)}</div>{carDue.length === 0 && <div className="panel-empty"><ClipboardList size={20} /><div><strong>{t('car.noTasks')}</strong><p>{t('car.addTaskHint')}</p></div></div>}</section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">{t('car.history')}</span><h2>{t('car.latestVisits')}</h2></div><span className="count-badge">{number(carVisits.length)}</span></div>{carVisits.length ? <div className="recent-list">{carVisits.slice(0, 6).map((visit) => <div className="recent-row" key={visit.id}><span className="service-icon"><Wrench size={18} /></span><span className="recent-main"><strong>{visit.items.map((item) => item.name).join(", ") || t('shared.serviceVisit')}</strong><small>{displayDate(visit.date)} · {formatDistance(visit.odometer, car?.distanceUnit)}</small></span><strong>{money(visit.totalCostCents)}</strong></div>)}</div> : <div className="panel-empty"><Wrench size={20} /><div><strong>{t('car.noVisits')}</strong><p>{t('car.historyHint')}</p></div></div>}<button className="text-link danger-text" onClick={() => onDeleteCar(car)}><Trash2 size={15} />{t('car.delete')}</button></section></div>
    </>}
  </>;
}

function EmptyPanel({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {

return <div className="empty-panel"><span>{icon}</span><h2>{title}</h2><p>{description}</p>{action}</div>; }

function HistoryPage({ cars, visits, repository, onAdd, onEdit, onDelete }: { cars: Car[]; visits: Visit[]; repository: Repository; onAdd: () => void; onEdit: (visit: Visit) => void; onDelete: (visit: Visit) => void }) {
  const t = useTranslations();
  const [carId, setCarId] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("newest");
  const filtered = visits.filter((visit) => (!carId || visit.carId === carId) && (!from || visit.date >= from) && (!to || visit.date <= to) && (!query || `${visit.provider} ${visit.notes} ${visit.items.map((item) => item.name).join(" ")}`.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => {
    if (sort === "oldest") return a.date.localeCompare(b.date);
    if (sort === "cost_high") return b.totalCostCents - a.totalCostCents;
    if (sort === "cost_low") return a.totalCostCents - b.totalCostCents;
    if (sort === "odometer_high") return distanceInMiles(b.odometer, cars.find((car) => car.id === b.carId)?.distanceUnit) - distanceInMiles(a.odometer, cars.find((car) => car.id === a.carId)?.distanceUnit);
    return b.date.localeCompare(a.date);
  });
  function downloadCsv() { const blob = new Blob([visitsToCsv(filtered, cars)], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "garage-guardian-service-history.csv"; link.click(); URL.revokeObjectURL(url); }
  return <><PageHeading eyebrow={t('history.eyebrow')} title={t('navigation.history')} description={t('history.description')} action={<button className="button primary" onClick={onAdd} disabled={!cars.length}><Plus size={18} />{t('shared.logService')}</button>} />
    <div className="panel table-panel"><div className="table-toolbar"><div className="search-field"><Search size={18} /><input aria-label={t('history.search')} placeholder={t('history.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} /></div><select aria-label={t('history.filterCar')} value={carId} onChange={(e) => setCarId(e.target.value)}><option value="">{t('shared.allCars')}</option>{cars.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}</select><label className="date-filter">{t('history.from')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="date-filter">{t('history.to')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label><select aria-label={t('history.sort')} value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">{t('history.newest')}</option><option value="oldest">{t('history.oldest')}</option><option value="cost_high">{t('history.highCost')}</option><option value="cost_low">{t('history.lowCost')}</option><option value="odometer_high">{t('history.highOdometer')}</option></select><button className="button secondary" onClick={downloadCsv} disabled={!filtered.length}><ArrowDownToLine size={17} />{t('history.export')}</button></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>{t('shared.date')}</th><th>{t('shared.vehicle')}</th><th>{t('history.service')}</th><th>{t('history.odometer')}</th><th>{t('shared.provider')}</th><th>{t('history.cost')}</th><th>{t('shared.photos')}</th><th><span className="sr-only">{t('history.actions')}</span></th></tr></thead><tbody>{filtered.map((visit) => <HistoryRow key={visit.id} visit={visit} car={cars.find((car) => car.id === visit.carId)} repository={repository} onEdit={() => onEdit(visit)} onDelete={() => onDelete(visit)} />)}</tbody></table></div> : <EmptyPanel icon={<ClipboardList size={23} />} title={visits.length ? t('history.noMatches') : t('history.empty')} description={visits.length ? t('history.changeFilters') : t('history.firstVisit')} />}
      <div className="table-footer">{t('history.showing', { count: filtered.length, total: visits.length })}</div></div>
  </>;
}

function HistoryRow({ visit, car, repository, onEdit, onDelete }: { visit: Visit; car?: Car; repository: Repository; onEdit: () => void; onDelete: () => void }) {
  const t = useTranslations();
  const { number, money, displayDate, formatDistance } = useDisplay();
  const [expanded, setExpanded] = useState(false);
  const [photoError, setPhotoError] = useState<AppFailure | null>(null);
  async function downloadPhoto(photo: Photo) { try { setPhotoError(null); const url = await repository.photoUrl(photo); const link = document.createElement("a"); link.href = url; link.download = photo.name; link.target = "_blank"; link.click(); if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (cause) { setPhotoError(failureOf(cause, 'photo')); } }
  return <><tr><td>{displayDate(visit.date)}</td><td><strong>{car?.name ?? t('history.unknown')}</strong></td><td><button className="table-expand" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{visit.items.map((item) => item.name).join(", ") || t('shared.serviceVisit')}<ChevronDown size={15} /></button></td><td>{formatDistance(visit.odometer, car?.distanceUnit)}</td><td>{visit.provider || "—"}</td><td><strong>{money(visit.totalCostCents)}</strong></td><td>{visit.photos.length ? number(visit.photos.length) : "—"}</td><td><div className="row-actions"><button className="icon-button" onClick={onEdit} aria-label={t('history.edit')}><Settings2 size={16} /></button><button className="icon-button danger" onClick={onDelete} aria-label={t('history.delete')}><Trash2 size={16} /></button></div></td></tr>{expanded && <tr className="detail-row"><td colSpan={8}><div className="visit-detail"><div><strong>{t('history.itemsCompleted')}</strong><p>{visit.items.map((item) => `${item.name}${item.costCents !== null ? ` (${money(item.costCents)})` : ""}`).join(" · ") || t('history.noneRecorded')}</p></div>{visit.notes && <div><strong>{t('shared.notes')}</strong><p>{visit.notes}</p></div>}{visit.photos.length > 0 && <div><strong>{t('shared.photos')}</strong><div className="photo-links">{visit.photos.map((photo) => <button key={photo.id} className="text-link" onClick={() => void downloadPhoto(photo)}><ArrowDownToLine size={15} />{photo.name}</button>)}</div>{photoError && <p className="error-text">{t(`errors.${photoError.code}`, photoError.values)}</p>}</div>}</div></td></tr>}</>;
}

function ReportsPage({ cars, visits }: { cars: Car[]; visits: Visit[] }) {
  const t = useTranslations();
  const { money, month: formatMonth } = useDisplay();
  const [carId, setCarId] = useState("");
  const [year, setYear] = useState("");
  const years = [...new Set(visits.map((visit) => visit.date.slice(0, 4)))].sort().reverse();
  const filtered = visits.filter((visit) => (!carId || visit.carId === carId) && (!year || visit.date.startsWith(year)));
  const totals = reportTotals(filtered, cars);
  const maxMonth = Math.max(1, ...totals.byMonth.map(([, amount]) => amount));
  return <><PageHeading eyebrow={t('reports.insights')} title={t('navigation.reports')} description={t('reports.description')} /><div className="report-filters"><select aria-label={t('reports.carFilter')} value={carId} onChange={(e) => setCarId(e.target.value)}><option value="">{t('shared.allCars')}</option>{cars.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}</select><select aria-label={t('reports.yearFilter')} value={year} onChange={(e) => setYear(e.target.value)}><option value="">{t('reports.allTime')}</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
    <div className="report-stat-grid"><div className="report-total"><span className="eyebrow">{t('reports.totalSpent')}</span><strong>{money(totals.totalCents)}</strong><small>{t('reports.visitCount', { count: filtered.length })}</small></div><div className="report-total"><span className="eyebrow">{t('reports.average')}</span><strong>{money(filtered.length ? Math.round(totals.totalCents / filtered.length) : 0)}</strong><small>{t('reports.loggedVisits')}</small></div></div>
    {filtered.length ? <div className="report-grid"><section className="panel"><div className="section-heading"><div><span className="eyebrow">{t('reports.spending')}</span><h2>{t('reports.overTime')}</h2></div></div><div className="bar-chart">{totals.byMonth.map(([month, amount]) => <div className="bar-row" key={month}><span>{formatMonth(month)}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(3, amount / maxMonth * 100)}%` }} /></div><strong>{money(amount)}</strong></div>)}</div></section><section className="panel"><div className="section-heading"><div><span className="eyebrow">{t('reports.breakdown')}</span><h2>{t('reports.byVehicle')}</h2></div></div><div className="breakdown-list">{totals.byCar.map(({ id, name, amount }) => <div className="breakdown-row" key={id}><span>{name ?? t("reports.unknownCar")}</span><strong>{money(amount)}</strong></div>)}</div><div className="section-heading second"><div><span className="eyebrow">{t('reports.breakdown')}</span><h2>{t('reports.byService')}</h2></div></div><div className="breakdown-list">{totals.byCategory.map(({ kind, name, amount }) => <div className="breakdown-row" key={JSON.stringify([kind, name])}><span>{kind === "unallocated" ? t("reports.unallocated") : name}</span><strong>{money(amount)}</strong></div>)}</div><p className="section-hint">{t('reports.costHint')}</p></section></div> : <EmptyPanel icon={<DollarSign size={24} />} title={t('reports.empty')} description={t('reports.emptyHint')} />}</>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  const t = useTranslations();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (dialog.current?.querySelector<HTMLElement>('.modal-body input, .modal-body select, .modal-body textarea') ?? dialog.current)?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) onClose(); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialog} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
    if (!controls?.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}><div className="modal-header"><div><h2>{title}</h2></div><LocaleSelector /><button className="icon-button" onClick={onClose} aria-label={t('shared.close')}><X size={20} /></button>{subtitle && <p>{subtitle}</p>}</div>{children}</div></div>;
}

function CarModal({ item, onClose, onSave }: { item?: Car; onClose: () => void; onSave: (item: Car, starter: boolean) => Promise<void> }) {
  const t = useTranslations();
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(distanceUnitOrDefault(item?.distanceUnit));
  const [reminderCustomized, setReminderCustomized] = useState(false);
  function changeDistanceUnit(unit: DistanceUnit) {
    setDistanceUnit(unit);
    if (!reminderCustomized) setReminderMiles(String(defaultReminderDistance(unit)));
  }
  const [name, setName] = useState(item?.name ?? ""); const [year, setYear] = useState(String(item?.year ?? new Date().getFullYear())); const [make, setMake] = useState(item?.make ?? ""); const [model, setModel] = useState(item?.model ?? ""); const [vin, setVin] = useState(item?.vin ?? ""); const [plate, setPlate] = useState(item?.plate ?? ""); const [odometer, setOdometer] = useState(String(item?.odometer ?? "")); const [reminderDays, setReminderDays] = useState(String(item?.reminderDays ?? 30)); const [reminderMiles, setReminderMiles] = useState(String(item?.reminderMiles ?? defaultReminderDistance(distanceUnit))); const [busy, setBusy] = useState(false); const [formError, setFormError] = useState<AppFailure | null>(null);
  const catalog = useVehicleCatalog(isCloudConfigured, make);
  async function submit(event: FormEvent) { event.preventDefault(); setFormError(null); const miles = Number(odometer); if (!Number.isInteger(miles) || miles < 0) { setFormError({ code: 'odometer' }); return; } setBusy(true); try { await onSave({ id: item?.id ?? newId(), name: name.trim(), year: Number(year), make: make.trim(), model: model.trim(), vin: vin.trim().toUpperCase(), plate: normalizePlate(plate), distanceUnit, odometer: miles, reminderDays: Number(reminderDays), reminderMiles: Number(reminderMiles), createdAt: item?.createdAt ?? new Date().toISOString() }, !item); } catch (cause) { setFormError(failureOf(cause, 'save')); } finally { setBusy(false); } }
  return <Modal title={item ? t('car.edit') : t('shared.addCar')} subtitle={t('car.modalSubtitle')} onClose={onClose}><form onSubmit={submit}><div className="modal-body form-stack"><label>{t('car.nickname')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('car.nicknameExample')} required maxLength={60} /></label><div className="form-grid three"><label>{t('car.year')}<input type="number" value={year} onChange={(e) => setYear(e.target.value)} min="1980" max={new Date().getFullYear() + 1} required /></label>{isCloudConfigured ? <EditableCombobox label={t('car.make')} value={make} onChange={setMake} placeholder="Toyota" suggestions={catalog.makes.entries} loading={catalog.makes.loading} failed={catalog.makes.failed} onRetry={catalog.retry} /> : <label>{t('car.make')}<input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" required maxLength={50} /></label>}{isCloudConfigured ? <EditableCombobox key={normalizeVehicleKey(make)} label={t('car.model')} value={model} onChange={setModel} placeholder="RAV4" suggestions={catalog.models.entries} loading={catalog.models.loading} failed={catalog.models.failed} onRetry={catalog.retry} /> : <label>{t('car.model')}<input value={model} onChange={(e) => setModel(e.target.value)} placeholder="RAV4" required maxLength={50} /></label>}</div><label>{t('car.distanceUnit')}{item ? <input value={distanceUnit === "kilometers" ? t('shared.kilometers') : t('shared.miles')} readOnly /> : <select value={distanceUnit} onChange={(e) => changeDistanceUnit(e.target.value as DistanceUnit)}><option value="miles">{t('shared.miles')}</option><option value="kilometers">{t('shared.kilometers')}</option></select>}</label><label>{t('car.odometerInput', { unit: t(`units.${distanceUnit}`) })}<input type="number" value={odometer} onChange={(e) => setOdometer(e.target.value)} min="0" step="1" placeholder="48250" required /></label><div className="form-grid"><label>VIN <span className="optional">{t('shared.optional')}</span><input value={vin} onChange={(e) => setVin(e.target.value)} maxLength={17} placeholder={t('car.vinExample')} /></label><label>{t('car.licensePlate')}<span className="optional">{t('shared.optional')}</span><input value={plate} onChange={(e) => setPlate(e.target.value)} aria-describedby="plate-help" placeholder={t('car.plateExample')} /><span id="plate-help" className="field-help">{t('car.plateHelp', { count: PLATE_MAX_LENGTH })}</span></label></div><div className="form-grid"><label>{t('car.reminderDays')}<input type="number" min="0" max="365" step="1" value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} required /></label><label>{t('car.reminderDistance', { unit: t(`units.${distanceUnit}`) })}<input type="number" min="0" max="10000" step="1" value={reminderMiles} onChange={(e) => { setReminderMiles(e.target.value); setReminderCustomized(true); }} required /></label></div>{!item && <div className="info-callout"><ClipboardList size={18} /><span>{t('car.starterHint')}</span></div>}{formError && <p className="error-text" role="alert">{t(`errors.${formError.code}`, formError.values)}</p>}</div><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>{t('shared.cancel')}</button><button className="button primary" disabled={busy}>{busy ? t('shared.saving') : item ? t('shared.saveChanges') : t('car.saveNew')}</button></div></form></Modal>;
}

function ScheduleModal({ item, carId, distanceUnit, onClose, onSave }: { item?: ScheduleItem; carId: string; distanceUnit: DistanceUnit; onClose: () => void; onSave: (item: ScheduleItem) => Promise<void> }) {
  const t = useTranslations();
  const [name, setName] = useState(item?.name ?? ""); const [intervalMiles, setIntervalMiles] = useState(item?.intervalMiles?.toString() ?? ""); const [intervalMonths, setIntervalMonths] = useState(item?.intervalMonths?.toString() ?? ""); const [firstDueMiles, setFirstDueMiles] = useState(item?.firstDueMiles?.toString() ?? ""); const [firstDueDate, setFirstDueDate] = useState(item?.firstDueDate ?? ""); const [sourceNote, setSourceNote] = useState(item?.sourceNote ?? ""); const [isActive, setIsActive] = useState(item?.isActive ?? true); const [busy, setBusy] = useState(false); const [formError, setFormError] = useState<AppFailure | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setFormError(null); try { await onSave({ id: item?.id ?? newId(), carId, name: name.trim(), intervalMiles: intervalMiles ? Number(intervalMiles) : null, intervalMonths: intervalMonths ? Number(intervalMonths) : null, firstDueMiles: firstDueMiles ? Number(firstDueMiles) : null, firstDueDate: firstDueDate || null, sourceNote: sourceNote.trim(), isActive, createdAt: item?.createdAt ?? new Date().toISOString() }); } catch (cause) { setFormError(failureOf(cause, 'save')); } finally { setBusy(false); } }
  return <Modal title={item ? t('schedule.edit') : t('schedule.add')} subtitle={t('schedule.subtitle')} onClose={onClose}><form onSubmit={submit}><div className="modal-body form-stack"><label>{t('schedule.name')}<input value={name} onChange={(e) => setName(e.target.value)} required placeholder={t('schedule.example')} maxLength={80} /></label><div className="form-grid"><label>{t('schedule.firstDistance', { unit: t(`units.${distanceUnit}`) })} <span className="optional">{t('shared.optional')}</span><input type="number" min="0" step="1" value={firstDueMiles} onChange={(e) => setFirstDueMiles(e.target.value)} placeholder={t('schedule.distanceExample')} /></label><label>{t('schedule.firstDate')}<span className="optional">{t('shared.optional')}</span><input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} /></label></div><div className="form-grid"><label>{t('schedule.repeatDistance', { unit: t(`units.${distanceUnit}`) })} <span className="optional">{t('shared.optional')}</span><input type="number" min="1" step="1" value={intervalMiles} onChange={(e) => setIntervalMiles(e.target.value)} placeholder={t('schedule.intervalExample')} /></label><label>{t('schedule.repeatMonths')}<span className="optional">{t('shared.optional')}</span><input type="number" min="1" step="1" value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)} placeholder={t('schedule.monthsExample')} /></label></div><p className="field-help">{t('schedule.hint')}</p><label>{t('schedule.source')}<span className="optional">{t('shared.optional')}</span><input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder={t('schedule.sourceExample')} maxLength={180} /></label><label className="checkbox-line"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />{t('schedule.active')}</label>{formError && <p className="error-text" role="alert">{t(`errors.${formError.code}`, formError.values)}</p>}</div><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>{t('shared.cancel')}</button><button className="button primary" disabled={busy}>{busy ? t('shared.saving') : t('schedule.save')}</button></div></form></Modal>;
}

type EditVisitItem = VisitItem & { key: string; costInput: string };
function VisitModal({ item, carId, cars, visits, schedules, repository, onClose, onSave }: { item?: Visit; carId?: string; cars: Car[]; visits: Visit[]; schedules: ScheduleItem[]; repository: Repository; onClose: () => void; onSave: (visit: Visit) => Promise<void> }) {
  const t = useTranslations();
  const photoInput = useRef<HTMLInputElement>(null);
  const initialCar = cars.find((car) => car.id === (item?.carId ?? carId ?? cars[0]?.id));
  const [selectedCarId, setSelectedCarId] = useState(item?.carId ?? carId ?? cars[0]?.id ?? ""); const [date, setDate] = useState(item?.date ?? todayISO()); const [odometer, setOdometer] = useState(String(item?.odometer ?? (initialCar ? latestOdometer(initialCar, visits) : ""))); const [totalCost, setTotalCost] = useState(item ? (item.totalCostCents / 100).toFixed(2) : ""); const [provider, setProvider] = useState(item?.provider ?? ""); const [notes, setNotes] = useState(item?.notes ?? ""); const [items, setItems] = useState<EditVisitItem[]>(item?.items.map((entry) => ({ ...entry, key: entry.id, costInput: entry.costCents === null ? "" : (entry.costCents / 100).toFixed(2) })) ?? [{ id: newId(), key: newId(), name: "", scheduleItemId: null, costCents: null, costInput: "" }]); const [files, setFiles] = useState<File[]>([]); const [retainedPhotos, setRetainedPhotos] = useState<Photo[]>(item?.photos ?? []); const [busy, setBusy] = useState(false); const [formError, setFormError] = useState<AppFailure | null>(null);
  const distanceUnit = distanceUnitOrDefault(cars.find((car) => car.id === selectedCarId)?.distanceUnit);
  const carSchedules = schedules.filter((schedule) => schedule.carId === selectedCarId && schedule.isActive);
  function updateEntry(key: string, update: Partial<EditVisitItem>) { setItems((current) => current.map((entry) => entry.key === key ? { ...entry, ...update } : entry)); }
  function pickSchedule(key: string, id: string) { const schedule = carSchedules.find((entry) => entry.id === id); updateEntry(key, { scheduleItemId: id || null, name: schedule?.name ?? "" }); }
  async function submit(event: FormEvent) { event.preventDefault(); setFormError(null); const miles = Number(odometer), cents = Math.round(Number(totalCost || "0") * 100); if (!selectedCarId || !Number.isInteger(miles) || miles < 0 || !Number.isInteger(cents) || cents < 0) { setFormError({ code: 'visitFields' }); return; } const cleanItems = items.filter((entry) => entry.name.trim()).map(({ key: _key, costInput: _costInput, ...entry }) => ({ ...entry, name: entry.name.trim() })); if (!cleanItems.length) { setFormError({ code: 'serviceItem' }); return; } if (cleanItems.reduce((sum, entry) => sum + (entry.costCents ?? 0), 0) > cents) { setFormError({ code: 'itemCosts' }); return; } setBusy(true); const uploaded: Photo[] = []; try { const visitId = item?.id ?? newId(); for (const file of files) uploaded.push(await repository.uploadPhoto(visitId, file)); await onSave({ id: visitId, carId: selectedCarId, date, odometer: miles, totalCostCents: cents, provider: provider.trim(), notes: notes.trim(), items: cleanItems, photos: [...retainedPhotos, ...uploaded], createdAt: item?.createdAt ?? new Date().toISOString() }); } catch (cause) { for (const photo of uploaded) await repository.removePhoto(photo).catch(() => undefined); setFormError(failureOf(cause, 'save')); } finally { setBusy(false); } }
  async function addFiles(list: FileList | null) { if (!list) return; setFormError(null); const incoming = Array.from(list); if (files.length + retainedPhotos.length + incoming.length > 3) { setFormError({ code: 'photoLimit' }); return; } try { const processed = await Promise.all(incoming.map(resizePhoto)); setFiles((current) => [...current, ...processed]); } catch (cause) { setFormError(failureOf(cause, 'photoPrepare')); } }
  return <Modal title={item ? t('visit.edit') : t('shared.logService')} subtitle={t('visit.subtitle')} onClose={onClose}><form onSubmit={submit}><div className="modal-body form-stack"><div className="form-grid"><label>{t('shared.vehicle')}<select value={selectedCarId} onChange={(e) => { setSelectedCarId(e.target.value); const car = cars.find((car) => car.id === e.target.value); setOdometer(car ? String(latestOdometer(car, visits)) : ""); setItems([{ id: newId(), key: newId(), name: "", scheduleItemId: null, costCents: null, costInput: "" }]); }} required disabled={Boolean(item)}>{cars.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}</select></label><label>{t('shared.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} required /></label></div><div className="form-grid"><label>{t('visit.odometerInput', { unit: t(`units.${distanceUnit}`) })}<input type="number" min="0" step="1" value={odometer} onChange={(e) => setOdometer(e.target.value)} required /></label><label>{t('visit.total')}<MoneyInput label={t('visit.total')} value={totalCost} onChange={setTotalCost} placeholder="0.00" required /></label></div><label>{t('shared.provider')}<span className="optional">{t('shared.optional')}</span><input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder={t('visit.providerExample')} maxLength={100} /></label><div className="items-editor"><div className="items-header"><strong>{t('visit.completedItems')}</strong><button type="button" className="text-link" onClick={() => setItems((current) => [...current, { id: newId(), key: newId(), name: "", scheduleItemId: null, costCents: null, costInput: "" }])}><Plus size={16} />{t('visit.addItem')}</button></div>{items.map((entry) => <div className="item-editor-row" key={entry.key}><select aria-label={t('visit.chooseTask')} value={entry.scheduleItemId ?? ""} onChange={(e) => pickSchedule(entry.key, e.target.value)}><option value="">{t('visit.custom')}</option>{carSchedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}</select><input aria-label={t('visit.itemName')} value={entry.name} onChange={(e) => updateEntry(entry.key, { name: e.target.value, scheduleItemId: null })} placeholder={t('visit.itemPlaceholder')} maxLength={80} /><MoneyInput label={t('visit.itemCost')} value={entry.costInput} onChange={(value) => updateEntry(entry.key, { costInput: value, costCents: value === "" ? null : Math.round(Number(value) * 100) })} placeholder={t('visit.costPlaceholder')} /><button type="button" className="icon-button danger" aria-label={t('visit.removeItem')} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((value) => value.key !== entry.key))}><X size={16} /></button></div>)}</div><label>{t('shared.notes')}<span className="optional">{t('shared.optional')}</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder={t('visit.notesExample')} maxLength={2000} /></label><div className="photo-picker"><label>{t('shared.photos')}<span className="optional">{t('visit.photoLimit')}</span><input ref={photoInput} className="sr-only" tabIndex={-1} type="file" accept="image/*" multiple onChange={(e) => void addFiles(e.target.files)} /></label><button type="button" className="button secondary" onClick={() => photoInput.current?.click()}>{t("visit.choosePhotos")}</button>{retainedPhotos.map((photo) => <span className="file-chip" key={photo.id}>{photo.name}<button type="button" aria-label={t('shared.removeNamed', { name: photo.name })} onClick={() => setRetainedPhotos((current) => current.filter((entry) => entry.id !== photo.id))}><X size={13} /></button></span>)}{files.map((file, index) => <span className="file-chip" key={`${file.name}-${index}`}>{file.name}<button type="button" aria-label={t('shared.removeNamed', { name: file.name })} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><X size={13} /></button></span>)}</div>{formError && <p className="error-text" role="alert">{t(`errors.${formError.code}`, formError.values)}</p>}</div><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>{t('shared.cancel')}</button><button className="button primary" disabled={busy}>{busy ? t('shared.saving') : item ? t('shared.saveChanges') : t('visit.save')}</button></div></form></Modal>;
}

async function resizePhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new AppError('imageOnly');
  const bitmap = await createImageBitmap(file).catch(() => { throw new AppError("photoPrepare"); });
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d"); if (!context) throw new AppError('photoUnsupported');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob) throw new AppError('photoPrepare');
  if (blob.size > 2_000_000) throw new AppError('photoTooLarge');
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
}

"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine, ArrowRight, CalendarDays, CarFront, Check, ChevronDown, CircleAlert,
  ClipboardList, DollarSign, Gauge, LayoutDashboard, LogOut, Menu, Plus, Search,
  Settings2, Trash2, Wrench, X,
} from "lucide-react";
import { getAllDue, dueDescription, latestOdometer, type DueItem } from "@/lib/due";
import { isCloudConfigured, type Repository } from "@/lib/repository";
import { useGarageSession, errorMessage } from "@/lib/use-garage-session";
import { normalizePlate, PLATE_MAX_LENGTH, defaultReminderDistance, distanceInMiles, distanceUnitOrDefault, displayDate, formatDistance, makeStarterSchedules, money, newId, type Car, type DistanceUnit, type ScheduleItem, type Visit, type VisitItem, type Photo } from "@/lib/model";
import { reportTotals, visitsToCsv } from "@/lib/reports";
import { MoneyInput } from "./money-input";
import { GarageLogo } from "./garage-logo";
import { EditableCombobox } from "./editable-combobox";
import { useVehicleCatalog } from "@/lib/use-vehicle-catalog";
import { normalizeVehicleKey } from "@/lib/vehicle-catalog";
import { BugReporter } from "./bug-reporter";

type Page = "dashboard" | "cars" | "history" | "reports";
type ModalState = { kind: "car"; item?: Car } | { kind: "schedule"; item?: ScheduleItem; carId: string } | { kind: "visit"; item?: Visit; carId?: string } | null;

const navigation = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "cars", label: "My cars", icon: CarFront },
  { id: "history", label: "Service history", icon: ClipboardList },
  { id: "reports", label: "Reports", icon: DollarSign },
] as const;
const todayISO = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

export function GarageApp() {
  const garage = useGarageSession();
  const { repository, snapshot, user, loading, transferring, error, setError } = garage;
  const [page, setPage] = useState<Page>("dashboard");
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedCarId, setSelectedCarId] = useState<string>("");
  const [authView, setAuthView] = useState<"signin" | "signup" | null>(null);
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (loading) { setModal(null); setSelectedCarId(""); }
    if (user) { setAuthView(null); setNotice(""); }
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
    ? <button className="button secondary" onClick={() => void garage.signOut()}><LogOut size={17} />Sign out</button>
    : isCloudConfigured && <div className="account-actions"><button className="button secondary" onClick={() => setAuthView("signin")}>Sign in</button><button className="button primary" onClick={() => setAuthView("signup")}>Create account</button></div>;

  if (loading || !repository) return <>{reporter}<div className="auth-page"><div className="auth-card"><h1>{transferring ? "Moving your garage to Supabase" : "Opening your garage"}</h1>{loading ? <p role="status">{transferring ? "Uploading your records and photos. Your browser copy is kept until the transfer is verified." : "Loading your records…"}</p> : <><p className="error-text" role="alert">{error}</p><button className="button primary" onClick={garage.retry}>Retry</button></>}{user && <div className="recovery-actions">{accountActions}</div>}</div></div></>;
  if (authView && !user) return <AccountForm mode={authView} onMode={setAuthView} onClose={() => setAuthView(null)} onSubmit={async (email, password) => {
    if (authView === "signup") {
      const confirmation = await garage.signUp(email, password);
      if (confirmation) setNotice("Check your email to confirm your account, then sign in here. Until then, your data stays in this browser.");
    } else await garage.signIn(email, password);
    setAuthView(null);
  }} />;

  return <>{reporter}<div className="app-shell">
    <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><GarageLogo /></div><div><strong>Garage Guardian</strong><small>CARE FOR THE DRIVE</small></div></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        {navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${page === id ? "active" : ""}`} onClick={() => { setPage(id); setMenuOpen(false); }}><Icon size={19} /><span>{label}</span>{page === id && <span className="nav-indicator" />}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-summary"><span className="summary-icon"><CarFront size={18} /></span><div><strong>{snapshot.cars.length} {snapshot.cars.length === 1 ? "vehicle" : "vehicles"}</strong><small>in your garage</small></div></div>
        <div className="account-line"><span className="avatar">{user?.email ? user.email[0].toUpperCase() : "G"}</span><span className="account-text"><strong>{user?.email || (isCloudConfigured ? "Guest" : "Local prototype")}</strong><small>{user ? "Stored in Supabase" : "Stored in this browser"}</small></span></div>
      </div>
    </aside>

    <div className="main-wrap">
      <header className="topbar"><button className="mobile-menu icon-button" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={22} /></button><span className="breadcrumbs">YOUR GARAGE <span>/</span> <strong>{navigation.find((item) => item.id === page)?.label}</strong></span><span className="topbar-right"><span className="today-pill"><CalendarDays size={15} />{displayDate(todayISO())}</span></span></header>
      <main className="content">
        {isCloudConfigured && <div className="storage-account"><span>{user ? "Stored in Supabase" : "Guest — stored in this browser"}</span>{accountActions}</div>}
        {notice && <div className="demo-banner" role="status">{notice}</div>}
        {error && <div className="error-banner" role="alert"><CircleAlert size={18} />{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}
        {!isCloudConfigured && <div className="demo-banner"><CircleAlert size={17} /><span>Local prototype: your data stays in this browser. Add Supabase credentials to enable private cloud sync.</span></div>}
        {page === "dashboard" && <Dashboard cars={snapshot.cars} visits={visits} allDue={allDue} onAddCar={() => setModal({ kind: "car" })} onAddVisit={() => setModal({ kind: "visit" })} onViewCar={(id) => { setSelectedCarId(id); setPage("cars"); }} onViewAll={() => setPage("history")} />}
        {page === "cars" && <CarsPage cars={snapshot.cars} schedules={snapshot.schedules} visits={visits} allDue={allDue} selectedCar={selectedCar} onSelect={setSelectedCarId} onAdd={() => setModal({ kind: "car" })} onEdit={(item) => setModal({ kind: "car", item })} onAddSchedule={(carId) => setModal({ kind: "schedule", carId })} onEditSchedule={(item) => setModal({ kind: "schedule", carId: item.carId, item })} onAddVisit={(carId) => setModal({ kind: "visit", carId })} onDeleteCar={async (car) => { if (confirm(`Delete ${car.name} and all its records? This cannot be undone.`)) await perform(() => repository!.deleteCar(car.id)); }} onDeleteSchedule={async (item) => { if (confirm(`Delete ${item.name} from this car's schedule?`)) await perform(() => repository!.deleteSchedule(item.id)); }} />}
        {page === "history" && <HistoryPage cars={snapshot.cars} visits={visits} repository={repository!} onAdd={() => setModal({ kind: "visit" })} onEdit={(item) => setModal({ kind: "visit", item })} onDelete={async (visit) => { if (confirm("Delete this service visit?")) await perform(() => repository!.deleteVisit(visit)); }} />}
        {page === "reports" && <ReportsPage cars={snapshot.cars} visits={visits} />}
      </main>
    </div>

    <nav className="mobile-tabs" aria-label="Mobile navigation">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}><Icon size={20} /><span>{label === "Service history" ? "History" : label}</span></button>)}</nav>

    {modal?.kind === "car" && <CarModal item={modal.item} onClose={() => setModal(null)} onSave={async (car, starter) => { await perform(async () => { await repository!.saveCar(car); if (starter) for (const item of makeStarterSchedules(car.id)) await repository!.saveSchedule(item); }); setSelectedCarId(car.id); setPage("cars"); }} />}
    {modal?.kind === "schedule" && <ScheduleModal item={modal.item} carId={modal.carId} distanceUnit={snapshot.cars.find((car) => car.id === modal.carId)?.distanceUnit ?? "miles"} onClose={() => setModal(null)} onSave={async (item) => perform(() => repository!.saveSchedule(item))} />}
    {modal?.kind === "visit" && <VisitModal item={modal.item} carId={modal.carId} cars={snapshot.cars} visits={visits} schedules={snapshot.schedules} repository={repository!} onClose={() => setModal(null)} onSave={async (item) => perform(() => repository!.saveVisit(item))} />}
  </div></>;
}

const messageOf = errorMessage;

function AccountForm({ mode, onMode, onClose, onSubmit }: { mode: "signin" | "signup"; onMode: (mode: "signin" | "signup") => void; onClose: () => void; onSubmit: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signup = mode === "signup";
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSubmit(email.trim(), password); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  }
  return <div className="auth-page"><div className="auth-card"><div className="brand"><div className="brand-mark"><GarageLogo /></div><div><strong>Garage Guardian</strong><small>CARE FOR THE DRIVE</small></div></div><h1>{signup ? "Create your account" : "Welcome back"}</h1><p>{signup ? "Your browser records and photos will move to your account after you sign up and sign in." : "Sign in to your cloud garage. Existing guest records stay in this browser."}</p>{error && <div className="error-banner" role="alert">{error}</div>}<form onSubmit={submit} className="form-stack"><label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={signup ? 6 : undefined} autoComplete={signup ? "new-password" : "current-password"} /></label><button className="button primary full" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Sign in"}<ArrowRight size={17} /></button><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Continue without an account</button><button type="button" className="text-link" disabled={busy} onClick={() => { setError(""); setPassword(""); onMode(signup ? "signin" : "signup"); }}>{signup ? "Already have an account? Sign in" : "Create an account"}</button></form></div></div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}

function Dashboard({ cars, visits, allDue, onAddCar, onAddVisit, onViewCar, onViewAll }: { cars: Car[]; visits: Visit[]; allDue: DueItem[]; onAddCar: () => void; onAddVisit: () => void; onViewCar: (id: string) => void; onViewAll: () => void }) {
  const due = allDue.filter((item) => item.status === "due");
  const upcoming = allDue.filter((item) => item.status === "upcoming");
  const spendThisYear = visits.filter((visit) => visit.date.startsWith(String(new Date().getFullYear()))).reduce((sum, visit) => sum + visit.totalCostCents, 0);
  return <>
    <PageHeading eyebrow="OVERVIEW" title="Your garage at a glance" description="Stay on top of what has been done and what comes next." action={<button className="button primary" onClick={cars.length ? onAddVisit : onAddCar}><Plus size={18} />{cars.length ? "Log service" : "Add your first car"}</button>} />
    {cars.length === 0 ? <div className="empty-hero"><div className="empty-illustration"><CarFront size={55} strokeWidth={1.5} /></div><h2>Every car has a story. Start yours here.</h2><p>Add a vehicle to organize its service history and set a maintenance schedule from your owner’s manual.</p><button className="button primary" onClick={onAddCar}><Plus size={18} />Add a car</button></div> : <>
      <div className="stat-grid"><Stat icon={<CarFront size={20} />} label="Vehicles" value={String(cars.length)} detail="in your garage" /><Stat icon={<CircleAlert size={20} />} label="Due now" value={String(due.length)} detail="items need attention" accent={due.length > 0} /><Stat icon={<CalendarDays size={20} />} label="Coming up" value={String(upcoming.length)} detail="within reminder windows" /><Stat icon={<DollarSign size={20} />} label="Year-to-date spend" value={money(spendThisYear)} detail="across all vehicles" /></div>
      <div className="dashboard-grid"><section className="panel attention-panel"><div className="section-heading"><div><span className="eyebrow">MAINTENANCE</span><h2>What needs attention</h2></div><span className="count-badge">{due.length + upcoming.length}</span></div>{due.length + upcoming.length ? <div className="due-list">{[...due, ...upcoming].slice(0, 6).map((item) => <DueRow key={item.schedule.id} item={item} onClick={() => onViewCar(item.car.id)} />)}</div> : <div className="panel-empty"><Check size={21} /><div><strong>All caught up</strong><p>No scheduled work is due soon.</p></div></div>}{allDue.some((item) => item.status === "setup") && <div className="setup-note"><Settings2 size={16} />Some tasks need intervals from your owner’s manual.</div>}</section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">YOUR VEHICLES</span><h2>In the garage</h2></div></div><div className="vehicle-list">{cars.map((car) => { const count = allDue.filter((item) => item.car.id === car.id && item.status === "due").length; return <button className="vehicle-row" key={car.id} onClick={() => onViewCar(car.id)}><span className="vehicle-icon"><CarFront size={22} /></span><span><strong>{car.name}</strong><small>{car.year} {car.make} {car.model} · {formatDistance(latestOdometer(car, visits), car.distanceUnit)}</small></span>{count > 0 && <span className="tiny-alert">{count} due</span>}<ArrowRight size={17} /></button>; })}</div><button className="text-link" onClick={onAddCar}><Plus size={16} /> Add another car</button></section></div>
      <section className="panel recent-panel"><div className="section-heading"><div><span className="eyebrow">ACTIVITY</span><h2>Recent service</h2></div><button className="text-link" onClick={onViewAll}>View all <ArrowRight size={16} /></button></div>{visits.length ? <div className="recent-list">{visits.slice(0, 5).map((visit) => <div className="recent-row" key={visit.id}><span className="service-icon"><Wrench size={18} /></span><span className="recent-main"><strong>{visit.items.map((item) => item.name).join(", ") || "Service visit"}</strong><small>{cars.find((car) => car.id === visit.carId)?.name} · {displayDate(visit.date)}</small></span><strong>{money(visit.totalCostCents)}</strong></div>)}</div> : <div className="panel-empty"><Wrench size={20} /><div><strong>No service visits yet</strong><p>Your maintenance history will appear here.</p></div></div>}</section>
    </>}
  </>;
}

function Stat({ icon, label, value, detail, accent = false }: { icon: ReactNode; label: string; value: string; detail: string; accent?: boolean }) {
  return <div className={`stat-card ${accent ? "alert" : ""}`}><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span></div><strong>{value}</strong><small>{detail}</small></div>;
}

function DueRow({ item, onClick }: { item: DueItem; onClick?: () => void }) {
  const content = <><span className={`status-dot ${item.status}`} /><span className="due-main"><strong>{item.schedule.name}</strong><small>{item.car.name} · {dueDescription(item)}</small></span><span className={`status-pill ${item.status}`}>{item.status === "due" ? "Due now" : item.status === "upcoming" ? "Coming up" : item.status === "setup" ? "Set up" : item.status === "completed" ? "Done" : "Later"}</span></>;
  return onClick ? <button className="due-row" onClick={onClick}>{content}<ArrowRight size={16} /></button> : <div className="due-row">{content}</div>;
}

function CarsPage({ cars, schedules, visits, allDue, selectedCar, onSelect, onAdd, onEdit, onAddSchedule, onEditSchedule, onAddVisit, onDeleteCar, onDeleteSchedule }: { cars: Car[]; schedules: ScheduleItem[]; visits: Visit[]; allDue: DueItem[]; selectedCar: Car | null; onSelect: (id: string) => void; onAdd: () => void; onEdit: (car: Car) => void; onAddSchedule: (carId: string) => void; onEditSchedule: (item: ScheduleItem) => void; onAddVisit: (carId: string) => void; onDeleteCar: (car: Car) => void; onDeleteSchedule: (item: ScheduleItem) => void }) {
  const car = selectedCar ?? cars[0];
  const carDue = car ? allDue.filter((item) => item.car.id === car.id) : [];
  const carVisits = car ? visits.filter((visit) => visit.carId === car.id) : [];
  return <><PageHeading eyebrow="YOUR VEHICLES" title="My cars" description="Every vehicle’s history and maintenance plan, in one place." action={<button className="button primary" onClick={onAdd}><Plus size={18} />Add a car</button>} />
    {cars.length === 0 ? <EmptyPanel icon={<CarFront size={25} />} title="No cars yet" description="Add your first car to get started." action={<button className="button primary" onClick={onAdd}>Add a car</button>} /> : <>
      <div className="car-switcher" role="tablist" aria-label="Choose vehicle">{cars.map((item) => <button role="tab" aria-selected={car.id === item.id} className={`car-tab ${car.id === item.id ? "active" : ""}`} key={item.id} onClick={() => onSelect(item.id)}><CarFront size={19} /><span>{item.name}</span></button>)}</div>
      <div className="car-header panel"><div className="car-header-icon"><CarFront size={30} /></div><div className="car-header-copy"><span className="eyebrow">{car.year} {car.make.toUpperCase()} {car.model.toUpperCase()}</span><h2>{car.name}</h2><p><Gauge size={16} /> {formatDistance(latestOdometer(car, visits), car.distanceUnit)} current odometer {car.vin && ` · VIN ${car.vin}`}</p>{car.plate && <p className="car-plate">Plate: {car.plate}</p>}</div><div className="car-header-actions"><button className="button secondary" onClick={() => onEdit({ ...car, odometer: latestOdometer(car, visits) })}><Settings2 size={16} />Edit car</button><button className="button primary" onClick={() => onAddVisit(car.id)}><Plus size={17} />Log service</button></div></div>
      <div className="car-content-grid"><section className="panel"><div className="section-heading"><div><span className="eyebrow">SERVICE PLAN</span><h2>Maintenance schedule</h2></div><button className="text-link" onClick={() => onAddSchedule(car.id)}><Plus size={16} />Add task</button></div><p className="section-hint">Set intervals from your owner’s manual. Starter tasks are examples only.</p><div className="schedule-list">{carDue.map((due) => <div className="schedule-row" key={due.schedule.id}><span className={`status-dot ${due.status}`} /><div className="schedule-main"><strong>{due.schedule.name}</strong><small>{dueDescription(due)}</small>{due.schedule.sourceNote && <small>Source: {due.schedule.sourceNote}</small>}</div><span className={`status-pill ${due.status}`}>{due.status === "due" ? "Due" : due.status === "upcoming" ? "Soon" : due.status === "setup" ? "Set up" : due.status === "completed" ? "Done" : "Later"}</span><button className="icon-button" aria-label={`Edit ${due.schedule.name}`} onClick={() => onEditSchedule(due.schedule)}><Settings2 size={16} /></button><button className="icon-button danger" aria-label={`Delete ${due.schedule.name}`} onClick={() => onDeleteSchedule(due.schedule)}><Trash2 size={16} /></button></div>)}</div>{carDue.length === 0 && <div className="panel-empty"><ClipboardList size={20} /><div><strong>No schedule tasks</strong><p>Add a task and its due interval.</p></div></div>}</section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">HISTORY</span><h2>Latest visits</h2></div><span className="count-badge">{carVisits.length}</span></div>{carVisits.length ? <div className="recent-list">{carVisits.slice(0, 6).map((visit) => <div className="recent-row" key={visit.id}><span className="service-icon"><Wrench size={18} /></span><span className="recent-main"><strong>{visit.items.map((item) => item.name).join(", ") || "Service visit"}</strong><small>{displayDate(visit.date)} · {formatDistance(visit.odometer, car?.distanceUnit)}</small></span><strong>{money(visit.totalCostCents)}</strong></div>)}</div> : <div className="panel-empty"><Wrench size={20} /><div><strong>No visits logged</strong><p>Log maintenance to start this car’s history.</p></div></div>}<button className="text-link danger-text" onClick={() => onDeleteCar(car)}><Trash2 size={15} />Delete car and records</button></section></div>
    </>}
  </>;
}

function EmptyPanel({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) { return <div className="empty-panel"><span>{icon}</span><h2>{title}</h2><p>{description}</p>{action}</div>; }

function HistoryPage({ cars, visits, repository, onAdd, onEdit, onDelete }: { cars: Car[]; visits: Visit[]; repository: Repository; onAdd: () => void; onEdit: (visit: Visit) => void; onDelete: (visit: Visit) => void }) {
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
  return <><PageHeading eyebrow="SERVICE LOG" title="Service history" description="A clear record of every visit, receipt, and completed task." action={<button className="button primary" onClick={onAdd} disabled={!cars.length}><Plus size={18} />Log service</button>} />
    <div className="panel table-panel"><div className="table-toolbar"><div className="search-field"><Search size={18} /><input aria-label="Search service history" placeholder="Search service or provider" value={query} onChange={(e) => setQuery(e.target.value)} /></div><select aria-label="Filter by car" value={carId} onChange={(e) => setCarId(e.target.value)}><option value="">All cars</option>{cars.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}</select><label className="date-filter">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="date-filter">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label><select aria-label="Sort service history" value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="cost_high">Highest cost</option><option value="cost_low">Lowest cost</option><option value="odometer_high">Highest odometer</option></select><button className="button secondary" onClick={downloadCsv} disabled={!filtered.length}><ArrowDownToLine size={17} />Export CSV</button></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Vehicle</th><th>Service</th><th>Odometer</th><th>Provider</th><th>Cost</th><th>Photos</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map((visit) => <HistoryRow key={visit.id} visit={visit} car={cars.find((car) => car.id === visit.carId)} repository={repository} onEdit={() => onEdit(visit)} onDelete={() => onDelete(visit)} />)}</tbody></table></div> : <EmptyPanel icon={<ClipboardList size={23} />} title={visits.length ? "No matching records" : "No service history yet"} description={visits.length ? "Try changing your filters." : "Log your first visit to begin your record."} />}
      <div className="table-footer">Showing {filtered.length} of {visits.length} visits</div></div>
  </>;
}

function HistoryRow({ visit, car, repository, onEdit, onDelete }: { visit: Visit; car?: Car; repository: Repository; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [photoError, setPhotoError] = useState("");
  async function downloadPhoto(photo: Photo) { try { setPhotoError(""); const url = await repository.photoUrl(photo); const link = document.createElement("a"); link.href = url; link.download = photo.name; link.target = "_blank"; link.click(); if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (cause) { setPhotoError(messageOf(cause)); } }
  return <><tr><td>{displayDate(visit.date)}</td><td><strong>{car?.name ?? "Unknown"}</strong></td><td><button className="table-expand" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{visit.items.map((item) => item.name).join(", ") || "Service visit"}<ChevronDown size={15} /></button></td><td>{formatDistance(visit.odometer, car?.distanceUnit)}</td><td>{visit.provider || "—"}</td><td><strong>{money(visit.totalCostCents)}</strong></td><td>{visit.photos.length || "—"}</td><td><div className="row-actions"><button className="icon-button" onClick={onEdit} aria-label="Edit visit"><Settings2 size={16} /></button><button className="icon-button danger" onClick={onDelete} aria-label="Delete visit"><Trash2 size={16} /></button></div></td></tr>{expanded && <tr className="detail-row"><td colSpan={8}><div className="visit-detail"><div><strong>Items completed</strong><p>{visit.items.map((item) => `${item.name}${item.costCents !== null ? ` (${money(item.costCents)})` : ""}`).join(" · ") || "None recorded"}</p></div>{visit.notes && <div><strong>Notes</strong><p>{visit.notes}</p></div>}{visit.photos.length > 0 && <div><strong>Photos</strong><div className="photo-links">{visit.photos.map((photo) => <button key={photo.id} className="text-link" onClick={() => void downloadPhoto(photo)}><ArrowDownToLine size={15} />{photo.name}</button>)}</div>{photoError && <p className="error-text">{photoError}</p>}</div>}</div></td></tr>}</>;
}

function ReportsPage({ cars, visits }: { cars: Car[]; visits: Visit[] }) {
  const [carId, setCarId] = useState("");
  const [year, setYear] = useState("");
  const years = [...new Set(visits.map((visit) => visit.date.slice(0, 4)))].sort().reverse();
  const filtered = visits.filter((visit) => (!carId || visit.carId === carId) && (!year || visit.date.startsWith(year)));
  const totals = reportTotals(filtered, cars);
  const maxMonth = Math.max(1, ...totals.byMonth.map(([, amount]) => amount));
  return <><PageHeading eyebrow="INSIGHTS" title="Reports" description="See what caring for your cars has cost over time." /><div className="report-filters"><select aria-label="Report car" value={carId} onChange={(e) => setCarId(e.target.value)}><option value="">All cars</option>{cars.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}</select><select aria-label="Report year" value={year} onChange={(e) => setYear(e.target.value)}><option value="">All time</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
    <div className="report-stat-grid"><div className="report-total"><span className="eyebrow">TOTAL SPENT</span><strong>{money(totals.totalCents)}</strong><small>{filtered.length} service {filtered.length === 1 ? "visit" : "visits"} in this view</small></div><div className="report-total"><span className="eyebrow">AVERAGE PER VISIT</span><strong>{money(filtered.length ? Math.round(totals.totalCents / filtered.length) : 0)}</strong><small>based on logged visits</small></div></div>
    {filtered.length ? <div className="report-grid"><section className="panel"><div className="section-heading"><div><span className="eyebrow">SPENDING</span><h2>Over time</h2></div></div><div className="bar-chart">{totals.byMonth.map(([month, amount]) => <div className="bar-row" key={month}><span>{month}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(3, amount / maxMonth * 100)}%` }} /></div><strong>{money(amount)}</strong></div>)}</div></section><section className="panel"><div className="section-heading"><div><span className="eyebrow">BREAKDOWN</span><h2>By vehicle</h2></div></div><div className="breakdown-list">{totals.byCar.map(([name, amount]) => <div className="breakdown-row" key={name}><span>{name}</span><strong>{money(amount)}</strong></div>)}</div><div className="section-heading second"><div><span className="eyebrow">BREAKDOWN</span><h2>By service</h2></div></div><div className="breakdown-list">{totals.byCategory.map(([name, amount]) => <div className="breakdown-row" key={name}><span>{name}</span><strong>{money(amount)}</strong></div>)}</div><p className="section-hint">Costs without item-level amounts appear as unallocated.</p></section></div> : <EmptyPanel icon={<DollarSign size={24} />} title="Nothing to report yet" description="Log a service visit to see your spending here." />}</>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (dialog.current?.querySelector<HTMLElement>('input, select, textarea') ?? dialog.current)?.focus();
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
  }}><div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>{children}</div></div>;
}

function CarModal({ item, onClose, onSave }: { item?: Car; onClose: () => void; onSave: (item: Car, starter: boolean) => Promise<void> }) {
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(distanceUnitOrDefault(item?.distanceUnit));
  const [reminderCustomized, setReminderCustomized] = useState(false);
  function changeDistanceUnit(unit: DistanceUnit) {
    setDistanceUnit(unit);
    if (!reminderCustomized) setReminderMiles(String(defaultReminderDistance(unit)));
  }
  const [name, setName] = useState(item?.name ?? ""); const [year, setYear] = useState(String(item?.year ?? new Date().getFullYear())); const [make, setMake] = useState(item?.make ?? ""); const [model, setModel] = useState(item?.model ?? ""); const [vin, setVin] = useState(item?.vin ?? ""); const [plate, setPlate] = useState(item?.plate ?? ""); const [odometer, setOdometer] = useState(String(item?.odometer ?? "")); const [reminderDays, setReminderDays] = useState(String(item?.reminderDays ?? 30)); const [reminderMiles, setReminderMiles] = useState(String(item?.reminderMiles ?? defaultReminderDistance(distanceUnit))); const [busy, setBusy] = useState(false); const [formError, setFormError] = useState("");
  const catalog = useVehicleCatalog(isCloudConfigured, make);
  async function submit(event: FormEvent) { event.preventDefault(); setFormError(""); const miles = Number(odometer); if (!Number.isInteger(miles) || miles < 0) { setFormError("Enter a valid, non-negative odometer reading."); return; } setBusy(true); try { await onSave({ id: item?.id ?? newId(), name: name.trim(), year: Number(year), make: make.trim(), model: model.trim(), vin: vin.trim().toUpperCase(), plate: normalizePlate(plate), distanceUnit, odometer: miles, reminderDays: Number(reminderDays), reminderMiles: Number(reminderMiles), createdAt: item?.createdAt ?? new Date().toISOString() }, !item); } catch (cause) { setFormError(messageOf(cause)); } finally { setBusy(false); } }
  return <Modal title={item ? "Edit car" : "Add a car"} subtitle="Give this vehicle a place in your garage." onClose={onClose}><form onSubmit={submit}><div className="modal-body form-stack"><label>Nickname<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily driver" required maxLength={60} /></label><div className="form-grid three"><label>Year<input type="number" value={year} onChange={(e) => setYear(e.target.value)} min="1980" max={new Date().getFullYear() + 1} required /></label>{isCloudConfigured ? <EditableCombobox label="Make" value={make} onChange={setMake} placeholder="Toyota" suggestions={catalog.makes.entries} loading={catalog.makes.loading} failed={catalog.makes.failed} onRetry={catalog.retry} /> : <label>Make<input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" required maxLength={50} /></label>}{isCloudConfigured ? <EditableCombobox key={normalizeVehicleKey(make)} label="Model" value={model} onChange={setModel} placeholder="RAV4" suggestions={catalog.models.entries} loading={catalog.models.loading} failed={catalog.models.failed} onRetry={catalog.retry} /> : <label>Model<input value={model} onChange={(e) => setModel(e.target.value)} placeholder="RAV4" required maxLength={50} /></label>}</div><label>Distance unit{item ? <input value={distanceUnit === "kilometers" ? "Kilometers" : "Miles"} readOnly /> : <select value={distanceUnit} onChange={(e) => changeDistanceUnit(e.target.value as DistanceUnit)}><option value="miles">Miles</option><option value="kilometers">Kilometers</option></select>}</label><label>Current odometer ({distanceUnit})<input type="number" value={odometer} onChange={(e) => setOdometer(e.target.value)} min="0" step="1" placeholder="48250" required /></label><div className="form-grid"><label>VIN <span className="optional">optional</span><input value={vin} onChange={(e) => setVin(e.target.value)} maxLength={17} placeholder="17 characters" /></label><label>License plate <span className="optional">optional</span><input value={plate} onChange={(e) => setPlate(e.target.value)} aria-describedby="plate-help" placeholder="e.g. AbC-123" /><span id="plate-help" className="field-help">Up to {PLATE_MAX_LENGTH} characters</span></label></div><div className="form-grid"><label>Coming up: days before due<input type="number" min="0" max="365" step="1" value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} required /></label><label>Coming up: {distanceUnit} before due<input type="number" min="0" max="10000" step="1" value={reminderMiles} onChange={(e) => { setReminderMiles(e.target.value); setReminderCustomized(true); }} required /></label></div>{!item && <div className="info-callout"><ClipboardList size={18} /><span>We’ll add common maintenance tasks. Set their intervals from your owner’s manual before reminders begin.</span></div>}{formError && <p className="error-text" role="alert">{formError}</p>}</div><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : item ? "Save changes" : "Add car"}</button></div></form></Modal>;
}

function ScheduleModal({ item, carId, distanceUnit, onClose, onSave }: { item?: ScheduleItem; carId: string; distanceUnit: DistanceUnit; onClose: () => void; onSave: (item: ScheduleItem) => Promise<void> }) {
  const [name, setName] = useState(item?.name ?? ""); const [intervalMiles, setIntervalMiles] = useState(item?.intervalMiles?.toString() ?? ""); const [intervalMonths, setIntervalMonths] = useState(item?.intervalMonths?.toString() ?? ""); const [firstDueMiles, setFirstDueMiles] = useState(item?.firstDueMiles?.toString() ?? ""); const [firstDueDate, setFirstDueDate] = useState(item?.firstDueDate ?? ""); const [sourceNote, setSourceNote] = useState(item?.sourceNote ?? ""); const [isActive, setIsActive] = useState(item?.isActive ?? true); const [busy, setBusy] = useState(false); const [formError, setFormError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setFormError(""); try { await onSave({ id: item?.id ?? newId(), carId, name: name.trim(), intervalMiles: intervalMiles ? Number(intervalMiles) : null, intervalMonths: intervalMonths ? Number(intervalMonths) : null, firstDueMiles: firstDueMiles ? Number(firstDueMiles) : null, firstDueDate: firstDueDate || null, sourceNote: sourceNote.trim(), isActive, createdAt: item?.createdAt ?? new Date().toISOString() }); } catch (cause) { setFormError(messageOf(cause)); } finally { setBusy(false); } }
  return <Modal title={item ? "Edit maintenance task" : "Add maintenance task"} subtitle="Use the intervals in your owner’s manual." onClose={onClose}><form onSubmit={submit}><div className="modal-body form-stack"><label>Task name<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Brake fluid" maxLength={80} /></label><div className="form-grid"><label>First due at odometer ({distanceUnit}) <span className="optional">optional</span><input type="number" min="0" step="1" value={firstDueMiles} onChange={(e) => setFirstDueMiles(e.target.value)} placeholder="e.g. 60,000" /></label><label>First due on date <span className="optional">optional</span><input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} /></label></div><div className="form-grid"><label>Repeat every {distanceUnit} <span className="optional">optional</span><input type="number" min="1" step="1" value={intervalMiles} onChange={(e) => setIntervalMiles(e.target.value)} placeholder="e.g. 5,000" /></label><label>Repeat every months <span className="optional">optional</span><input type="number" min="1" step="1" value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)} placeholder="e.g. 6" /></label></div><p className="field-help">If both date and odometer are set, the first one reached makes the task due. Leave repeat fields blank for a one-time task.</p><label>Manual or source note <span className="optional">optional</span><input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder="e.g. Owner’s manual, page 214" maxLength={180} /></label><label className="checkbox-line"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />Keep this task active</label>{formError && <p className="error-text" role="alert">{formError}</p>}</div><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save task"}</button></div></form></Modal>;
}

type EditVisitItem = VisitItem & { key: string; costInput: string };
function VisitModal({ item, carId, cars, visits, schedules, repository, onClose, onSave }: { item?: Visit; carId?: string; cars: Car[]; visits: Visit[]; schedules: ScheduleItem[]; repository: Repository; onClose: () => void; onSave: (visit: Visit) => Promise<void> }) {
  const initialCar = cars.find((car) => car.id === (item?.carId ?? carId ?? cars[0]?.id));
  const [selectedCarId, setSelectedCarId] = useState(item?.carId ?? carId ?? cars[0]?.id ?? ""); const [date, setDate] = useState(item?.date ?? todayISO()); const [odometer, setOdometer] = useState(String(item?.odometer ?? (initialCar ? latestOdometer(initialCar, visits) : ""))); const [totalCost, setTotalCost] = useState(item ? (item.totalCostCents / 100).toFixed(2) : ""); const [provider, setProvider] = useState(item?.provider ?? ""); const [notes, setNotes] = useState(item?.notes ?? ""); const [items, setItems] = useState<EditVisitItem[]>(item?.items.map((entry) => ({ ...entry, key: entry.id, costInput: entry.costCents === null ? "" : (entry.costCents / 100).toFixed(2) })) ?? [{ id: newId(), key: newId(), name: "", scheduleItemId: null, costCents: null, costInput: "" }]); const [files, setFiles] = useState<File[]>([]); const [retainedPhotos, setRetainedPhotos] = useState<Photo[]>(item?.photos ?? []); const [busy, setBusy] = useState(false); const [formError, setFormError] = useState("");
  const distanceUnit = distanceUnitOrDefault(cars.find((car) => car.id === selectedCarId)?.distanceUnit);
  const carSchedules = schedules.filter((schedule) => schedule.carId === selectedCarId && schedule.isActive);
  function updateEntry(key: string, update: Partial<EditVisitItem>) { setItems((current) => current.map((entry) => entry.key === key ? { ...entry, ...update } : entry)); }
  function pickSchedule(key: string, id: string) { const schedule = carSchedules.find((entry) => entry.id === id); updateEntry(key, { scheduleItemId: id || null, name: schedule?.name ?? "" }); }
  async function submit(event: FormEvent) { event.preventDefault(); setFormError(""); const miles = Number(odometer), cents = Math.round(Number(totalCost || "0") * 100); if (!selectedCarId || !Number.isInteger(miles) || miles < 0 || !Number.isInteger(cents) || cents < 0) { setFormError("Check the car, odometer, and cost fields."); return; } const cleanItems = items.filter((entry) => entry.name.trim()).map(({ key: _key, costInput: _costInput, ...entry }) => ({ ...entry, name: entry.name.trim() })); if (!cleanItems.length) { setFormError("Add at least one service item."); return; } if (cleanItems.reduce((sum, entry) => sum + (entry.costCents ?? 0), 0) > cents) { setFormError("Item costs cannot exceed the visit total."); return; } setBusy(true); const uploaded: Photo[] = []; try { const visitId = item?.id ?? newId(); for (const file of files) uploaded.push(await repository.uploadPhoto(visitId, file)); await onSave({ id: visitId, carId: selectedCarId, date, odometer: miles, totalCostCents: cents, provider: provider.trim(), notes: notes.trim(), items: cleanItems, photos: [...retainedPhotos, ...uploaded], createdAt: item?.createdAt ?? new Date().toISOString() }); } catch (cause) { for (const photo of uploaded) await repository.removePhoto(photo).catch(() => undefined); setFormError(messageOf(cause)); } finally { setBusy(false); } }
  async function addFiles(list: FileList | null) { if (!list) return; setFormError(""); const incoming = Array.from(list); if (files.length + retainedPhotos.length + incoming.length > 3) { setFormError("Up to 3 photos can be attached to a visit."); return; } try { const processed = await Promise.all(incoming.map(resizePhoto)); setFiles((current) => [...current, ...processed]); } catch (cause) { setFormError(messageOf(cause)); } }
  return <Modal title={item ? "Edit service visit" : "Log service"} subtitle="Keep the details together, even when one visit covers several tasks." onClose={onClose}><form onSubmit={submit}><div className="modal-body form-stack"><div className="form-grid"><label>Vehicle<select value={selectedCarId} onChange={(e) => { setSelectedCarId(e.target.value); const car = cars.find((car) => car.id === e.target.value); setOdometer(car ? String(latestOdometer(car, visits)) : ""); setItems([{ id: newId(), key: newId(), name: "", scheduleItemId: null, costCents: null, costInput: "" }]); }} required disabled={Boolean(item)}>{cars.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}</select></label><label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} required /></label></div><div className="form-grid"><label>Odometer ({distanceUnit})<input type="number" min="0" step="1" value={odometer} onChange={(e) => setOdometer(e.target.value)} required /></label><label>Total cost (USD)<MoneyInput label="Total cost (USD)" value={totalCost} onChange={setTotalCost} placeholder="0.00" required /></label></div><label>Provider <span className="optional">optional</span><input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. Downtown Toyota" maxLength={100} /></label><div className="items-editor"><div className="items-header"><strong>Completed items</strong><button type="button" className="text-link" onClick={() => setItems((current) => [...current, { id: newId(), key: newId(), name: "", scheduleItemId: null, costCents: null, costInput: "" }])}><Plus size={16} />Add item</button></div>{items.map((entry) => <div className="item-editor-row" key={entry.key}><select aria-label="Choose scheduled task" value={entry.scheduleItemId ?? ""} onChange={(e) => pickSchedule(entry.key, e.target.value)}><option value="">Other / custom</option>{carSchedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}</select><input aria-label="Service item name" value={entry.name} onChange={(e) => updateEntry(entry.key, { name: e.target.value, scheduleItemId: null })} placeholder="Service item" maxLength={80} /><MoneyInput label="Item cost in dollars" value={entry.costInput} onChange={(value) => updateEntry(entry.key, { costInput: value, costCents: value === "" ? null : Math.round(Number(value) * 100) })} placeholder="$ optional" /><button type="button" className="icon-button danger" aria-label="Remove service item" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((value) => value.key !== entry.key))}><X size={16} /></button></div>)}</div><label>Notes <span className="optional">optional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Parts used, recommendations, or anything to remember" maxLength={2000} /></label><div className="photo-picker"><label>Photos <span className="optional">up to 3</span><input type="file" accept="image/*" multiple onChange={(e) => void addFiles(e.target.files)} /></label>{retainedPhotos.map((photo) => <span className="file-chip" key={photo.id}>{photo.name}<button type="button" aria-label={`Remove ${photo.name}`} onClick={() => setRetainedPhotos((current) => current.filter((entry) => entry.id !== photo.id))}><X size={13} /></button></span>)}{files.map((file, index) => <span className="file-chip" key={`${file.name}-${index}`}>{file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><X size={13} /></button></span>)}</div>{formError && <p className="error-text" role="alert">{formError}</p>}</div><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : item ? "Save changes" : "Save visit"}</button></div></form></Modal>;
}

async function resizePhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose image files only.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d"); if (!context) throw new Error("This browser cannot process photos.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob) throw new Error("Could not prepare the photo.");
  if (blob.size > 2_000_000) throw new Error("Photo is too large after resizing. Choose a smaller image.");
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
}

import { AlertTriangle, ArrowRight, Banknote, BarChart3, Bell, BookOpen, Building2, Calendar, CalendarDays, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, Clock, Copy, Download, ExternalLink, Eye, Fan, FileText, Funnel, History, IdCard, Inbox, LayoutDashboard, LineChart, ListChecks, Lock, LogOut, Mail, MapPin, Menu, MoreHorizontal, Navigation, Package, Paperclip, Pencil, Phone, Pin, Plus, RadioTower, Receipt, Search, Send, Settings, ShieldCheck, Tag, Trash2, Truck, User, Users, Wallet, Wrench, X, type LucideProps } from "lucide-react";
import type { ComponentType } from "react";

const ICONS = {
  "alert-triangle": AlertTriangle, "arrow-right": ArrowRight, banknote: Banknote, "bar-chart-3": BarChart3, bell: Bell, "book-open": BookOpen, "building-2": Building2, calendar: Calendar,
  "calendar-days": CalendarDays, camera: Camera, check: Check, "chevron-down": ChevronDown, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, "circle-dollar-sign": CircleDollarSign,
  "clipboard-list": ClipboardList, clock: Clock, copy: Copy, download: Download, "external-link": ExternalLink, eye: Eye, fan: Fan, "file-text": FileText, funnel: Funnel, history: History,
  "id-card": IdCard, inbox: Inbox, "layout-dashboard": LayoutDashboard, "line-chart": LineChart, "list-checks": ListChecks, lock: Lock, "log-out": LogOut, mail: Mail, "map-pin": MapPin, menu: Menu,
  "more-horizontal": MoreHorizontal, navigation: Navigation, package: Package, paperclip: Paperclip, pencil: Pencil, phone: Phone, pin: Pin, plus: Plus, "radio-tower": RadioTower, receipt: Receipt,
  search: Search, send: Send, settings: Settings, "shield-check": ShieldCheck, tag: Tag, "trash-2": Trash2, truck: Truck, user: User, users: Users, wallet: Wallet, wrench: Wrench, x: X,
} satisfies Record<string, ComponentType<LucideProps>>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, className, ...props }: { name: string; size?: number; className?: string } & Omit<LucideProps, "size">) {
  const C = (ICONS as Record<string, ComponentType<LucideProps>>)[name] ?? Package;
  return <C size={size} strokeWidth={1.75} className={className} aria-hidden {...props} />;
}

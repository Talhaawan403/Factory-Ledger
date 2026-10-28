import { useEffect, useEffectEvent, useState, useRef } from 'react';
import {
  getSettings,
  saveSettings,
  clearAllData,
  getDispatches,
  getParties,
  getPayments,
  getGeneralExpenses,
  getPurchaseOrders,
  getLots,
  getMines,
  getAllBackupData,
  restoreBackup,
  mergeLedgerData,
  getTombstones,
  rollbackToPreRestoreSnapshot,
  getPreRestoreSnapshotMeta,
  setLedgerOwner,
  validateBackupPayload,
  getSyncConflictHistory,
  clearSyncConflictHistory,
  type PreRestoreSnapshotMeta,
  type BackupPayload,
} from '../lib/db';
import type { AppSettings } from '../types';
import { Capacitor } from '@capacitor/core';
import {
  User,
  Building2,
  Phone,
  Image,
  Moon,
  Sun,
  Check,
  Download,
  Upload,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronRight,
  Smartphone,
  Coins,
  FileText,
  Calendar,
  MapPin,
  Volume2,
  VolumeX,
  PenLine,
  Camera,
  Loader2,
  LogOut,
  RefreshCw,
  Lock,
  Fingerprint,
  ShieldCheck,
  Briefcase,
  Layers,
  /* Info, */
  Sliders,
  CloudOff,
  Lightbulb,
  History,
  Database,
  Sparkles,
} from 'lucide-react';
import { CURRENT_WHATS_NEW_VERSION } from '../components/WhatsNewModal';
import { triggerConfetti, playSuccessSound, playPopSound, playCashChime } from '../utils/delight';
import { exportDatabaseBackupJson, exportSyncConflictHistoryJson } from '../utils/exportSharing';
import { processImageFile } from '../utils/imageUtils';
import IOSConfirmModal from '../components/IOSConfirmModal';
import IOSSetPasscodeModal from '../components/IOSSetPasscodeModal';
import IOSVerifyPasscodeModal from '../components/IOSVerifyPasscodeModal';
import IOSImportConfirmModal from '../components/IOSImportConfirmModal';
import IOSTaxFormulaModal from '../components/IOSTaxFormulaModal';
import MaterialSettingsPanel from '../components/MaterialSettingsPanel';
import IOSTotpMfaModal from '../components/IOSTotpMfaModal';
import IOSSelect, { type IOSSelectOption } from '../components/IOSSelect';
import {
  loginWithGoogle,
  logoutUser,
  checkRedirectAuth,
  getFriendlyAuthErrorMessage,
  wipeCloudUserData,
  isFirebaseConfigured,
  cancelTotpSignIn,
  completeTotpSignIn,
  getFactoryLedgerTotpFactorCount,
  removeFactoryLedgerTotpFactors,
  TotpSignInRequiredError,
  type TotpSignInChallenge,
} from '../lib/firebase';
import { useSyncStatus, setRestoreConfirmed, type LoginScenarioResult } from '../lib/syncManager';
import { useLedgerListener } from '../hooks/useLedgerListener';
import {
  AccountSwitchModal,
  AnonymousConflictModal,
  SignOutActionSheet,
  ClearDataOptionsSheet,
} from '../components/AccountSyncModals';
import {
  isAppLockEnabled,
  isBiometricEnabled,
  setBiometricEnabled,
  disableAppLock,
  getLockTimeout,
  setLockTimeout,
  //  lockSession,
  isBiometricAvailable,
  registerBiometrics,
  getPinLength,
  getStoredPinHash,
  isDeviceLockAvailable,
} from '../utils/securityLock';

function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        fill="#EA4335"
      />
    </svg>
  );
}

{/*
/* const ACCENT_COLOR_OPTIONS = [
  { id: 'blue', name: 'Sapphire', color: '#007AFF' },
  { id: 'emerald', name: 'Emerald', color: '#10B981' },
  { id: 'violet', name: 'Violet', color: '#8B5CF6' },
  { id: 'amber', name: 'Amber', color: '#F59E0B' },
  { id: 'crimson', name: 'Ruby', color: '#F43F5E' },
]; 
*/}

const CURRENCY_SELECT_OPTIONS: IOSSelectOption<string>[] = [
  { value: 'PKR (Rs.)', label: 'PKR (Rs.)', subtitle: 'Pakistani Rupee · Local coal settlements', badge: 'Default' },
  { value: 'USD ($)', label: 'USD ($)', subtitle: 'US Dollar · International benchmark' },
  { value: 'AED (AED)', label: 'AED (AED)', subtitle: 'UAE Dirham · Gulf trade & shipping' },
  { value: 'SAR (SAR)', label: 'SAR (SAR)', subtitle: 'Saudi Riyal · Middle East transactions' },
  { value: 'EUR (€)', label: 'EUR (€)', subtitle: 'Euro · European commercial trade' },
  { value: 'INR (₹)', label: 'INR (₹)', subtitle: 'Indian Rupee · Regional trade' },
  { value: 'CNY (¥)', label: 'CNY (¥)', subtitle: 'Chinese Yuan · Direct imports' },
];

const NUMBER_FORMAT_OPTIONS: IOSSelectOption<'lakh' | 'million'>[] = [
  {
    value: 'million',
    label: 'International (Millions)',
    subtitle: 'Grouped as 1,250,000 (Three-digit international grouping)',
    badge: 'Default',
  },
  {
    value: 'lakh',
    label: 'South Asian (Lakhs & Crores)',
    subtitle: 'Grouped as 12,50,000 (Two-digit grouping standard in Pakistan)',
  },
];

const ACCOUNT_TYPE_OPTIONS: IOSSelectOption<string>[] = [
  { value: 'Commercial Coal Trader', label: 'Commercial Coal Trader', subtitle: 'Buys and sells coal lots with margin calculations' },
  { value: 'Broker & Commission Agent', label: 'Broker & Commission Agent', subtitle: 'Facilitates supply contracts between mines and mills' },
  { value: 'Factory Direct Procurement', label: 'Factory Direct Procurement', subtitle: 'Purchasing and testing coal for industrial consumption' },
  { value: 'Mining & Yard Operator', label: 'Mining & Yard Operator', subtitle: 'Pit-head depot, crushing, and logistics management' },
  { value: 'General Commodity Merchant', label: 'General Commodity Merchant', subtitle: 'Wholesale merchant handling multi-fuel commodities' },
];

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>({
    userName: '',
    businessName: '',
    phoneNumber: '',
    logoUrl: '',
    signatureUrl: '',
    companyAddress: '',
    ntnNumber: '',
    theme: 'light',
    currency: 'PKR (Rs.)',
    numberFormat: 'million',
    defaultTaxMethod: 'formula_18_5',
    taxFormulaSalesPercent: 18,
    taxFormulaIncomePercent: 5,
    accountType: 'Commercial Coal Trader',
  });
  const [showTaxFormulaModal, setShowTaxFormulaModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [stats, setStats] = useState({
    dispatches: 0,
    parties: 0,
    payments: 0,
    expenses: 0,
    pos: 0,
    mines: 0,
    lots: 0,
  });
  const [lastBackupDate, setLastBackupDate] = useState<string | null>(() => {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('fl_last_backup_date') : null;
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('coal_sound_enabled') !== 'false');
  // const [activeAccent, setActiveAccent] = useState(() => localStorage.getItem('coal_accent_theme') || 'blue');
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  const [isSignatureUploading, setIsSignatureUploading] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  // Security App Lock state
  const [appLockActive, setAppLockActive] = useState(() => isAppLockEnabled());
  const [bioActive, setBioActive] = useState(() => isBiometricEnabled());
  const [lockTimeoutSec, setLockTimeoutSec] = useState(() => getLockTimeout());
  const [pinLength, setPinLength] = useState(() => getPinLength());
  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const [isChangingPasscode, setIsChangingPasscode] = useState(false);
  const [isBioHardwareAvailable, setIsBioHardwareAvailable] = useState(false);

  // Collapsible dropdown groups (all collapsed by default per user specification)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    security: false,
    google: false,
    materials: false,
    business: false,
    appearance: false,
    currency: false,
    backup: false,
    about: false,
  });

  // Cloud Sync & Auth Manager
  const {
    status: syncStatus,
    lastSyncTime,
    isOnline,
    hasPendingChanges,
    unresolvedCount,
    isAutoSyncEnabled: autoSyncEnabled,
    currentUser: googleUser,
    syncNow,
    restoreFromCloud,
    setAutoSyncEnabled,
    checkLoginScenario,
    resolveLoginDecision,
    handleSignOut,
  } = useSyncStatus();

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRestoringFromCloud, setIsRestoringFromCloud] = useState(false);
  const [switchScenario, setSwitchScenario] = useState<LoginScenarioResult | null>(null);
  const [conflictScenario, setConflictScenario] = useState<LoginScenarioResult | null>(null);
  const [restoreConfirmationScenario, setRestoreConfirmationScenario] = useState<LoginScenarioResult | null>(null);
  const [isSignOutSheetOpen, setIsSignOutSheetOpen] = useState(false);
  const [totpSignInChallenge, setTotpSignInChallenge] = useState<TotpSignInChallenge | null>(null);
  const [, refreshLegacyTotpCount] = useState(0);
  const legacyTotpCount = googleUser ? getFactoryLedgerTotpFactorCount() : 0;

  // Modal triggers
  const [showRemoveLogoConfirm, setShowRemoveLogoConfirm] = useState(false);
  const [showRemoveSignatureConfirm, setShowRemoveSignatureConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showSeedConfirm, setShowSeedConfirm] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [showSignedInClearModal, setShowSignedInClearModal] = useState(false);
  const [showDisableLockConfirm, setShowDisableLockConfirm] = useState(false);
  const [showVerifyPinForDisable, setShowVerifyPinForDisable] = useState(false);
  const [showVerifyPinForExport, setShowVerifyPinForExport] = useState(false);
  const [showVerifyPinForConflictExport, setShowVerifyPinForConflictExport] = useState(false);
  const [showVerifyPinForImport, setShowVerifyPinForImport] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<{ name: string; data: BackupPayload } | null>(null);
  const [showImportConfirmModal, setShowImportConfirmModal] = useState(false);
  const [snapshotMeta, setSnapshotMeta] = useState<PreRestoreSnapshotMeta | null>(null);
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false);
  const [showRestoreCloudConfirm, setShowRestoreCloudConfirm] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [conflictArchiveCount, setConflictArchiveCount] = useState(0);
  const [isExportingConflicts, setIsExportingConflicts] = useState(false);
  const [showClearConflictArchiveConfirm, setShowClearConflictArchiveConfirm] = useState(false);

  // Issue 45: one-time migration notice for existing installs on formula_18_5 default
  const [showManualTaxNotice, setShowManualTaxNotice] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  const formatBackupDateTime = (dateStr?: string | null): string => {
    if (!dateStr) return 'Never created';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Never created';
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Never created';
    }
  };

  const formatBackupShort = (dateStr?: string | null): string => {
    if (!dateStr) return 'Never';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Never';
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return 'Never';
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadAllData = async () => {
    const [s, d, p, pay, expenses, pos, m, l, snap, conflicts] = await Promise.all([
      getSettings(),
      getDispatches(),
      getParties(),
      getPayments(),
      getGeneralExpenses(),
      getPurchaseOrders(),
      getMines(),
      getLots(),
      getPreRestoreSnapshotMeta(),
      getSyncConflictHistory(),
    ]);
    setSettings(s);
    setStats({
      dispatches: d.length,
      parties: p.length,
      payments: pay.length,
      expenses: expenses.length,
      pos: pos.length,
      mines: m.length,
      lots: l.length,
    });
    if (typeof localStorage !== 'undefined') {
      setLastBackupDate(localStorage.getItem('fl_last_backup_date'));
    }
    setSnapshotMeta(snap);
    setConflictArchiveCount(conflicts.length);
    setLoading(false);

    // Issue 45: Show one-time notice if existing install still uses formula_18_5 default
    const MIGRATION_FLAG = 'migrations.manualTaxNotice_v1';
    const alreadyShown = localStorage.getItem(MIGRATION_FLAG);
    if (!alreadyShown && s.defaultTaxMethod === 'formula_18_5') {
      setShowManualTaxNotice(true);
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      getSettings(),
      getDispatches(),
      getParties(),
      getPayments(),
      getGeneralExpenses(),
      getPurchaseOrders(),
      getMines(),
      getLots(),
      getPreRestoreSnapshotMeta(),
      getSyncConflictHistory(),
    ]).then(([s, d, p, pay, expenses, pos, m, l, snap, conflicts]) => {
      if (!active) return;
      setSettings(s);
      setStats({
        dispatches: d.length,
        parties: p.length,
        payments: pay.length,
        expenses: expenses.length,
        pos: pos.length,
        mines: m.length,
        lots: l.length,
      });
      if (typeof localStorage !== 'undefined') {
        setLastBackupDate(localStorage.getItem('fl_last_backup_date'));
      }
      setSnapshotMeta(snap);
      setConflictArchiveCount(conflicts.length);
      setLoading(false);

      const MIGRATION_FLAG = 'migrations.manualTaxNotice_v1';
      const alreadyShown = localStorage.getItem(MIGRATION_FLAG);
      if (!alreadyShown && s.defaultTaxMethod === 'formula_18_5') {
        setShowManualTaxNotice(true);
      }
    });

    isBiometricAvailable().then((avail) => {
      if (active) setIsBioHardwareAvailable(avail);
    });

    const handleLockStatusChange = () => {
      setAppLockActive(isAppLockEnabled());
      setBioActive(isBiometricEnabled());
      setLockTimeoutSec(getLockTimeout());
      setPinLength(getPinLength());
    };
    window.addEventListener('coal_lock_status_changed', handleLockStatusChange);
    return () => {
      active = false;
      window.removeEventListener('coal_lock_status_changed', handleLockStatusChange);
    };
  }, []);

  // Auto-refresh settings and stats when any mutation or cloud sync happens
  useLedgerListener(() => {
    loadAllData();
  });

  useEffect(() => {
    const refreshConflictCount = () => {
      getSyncConflictHistory()
        .then((entries) => setConflictArchiveCount(entries.length))
        .catch((err) => console.warn('Could not refresh conflict archive count:', err));
    };
    window.addEventListener('sync_conflict_archive_changed', refreshConflictCount);
    return () => window.removeEventListener('sync_conflict_archive_changed', refreshConflictCount);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleSection = (sectionKey: string) => {
    playPopSound();
    setOpenSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const handleChange = (field: keyof AppSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleAutoSave = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await saveSettings(settings);
    setSaved(true);
    playSuccessSound();
    triggerConfetti();
    showToast('Settings saved');
    setTimeout(() => setSaved(false), 2500);
  };

  const finishGoogleLogin = async (user: NonNullable<typeof googleUser>) => {
    localStorage.setItem('coal_google_user', JSON.stringify(user));
    const scenario = await checkLoginScenario(user);
    if (scenario.type === 'error') {
      playPopSound();
      showToast(scenario.message || 'Failed to verify cloud ledger.');
      return;
    }
    if (scenario.type === 'account_switch') {
      setSwitchScenario(scenario);
    } else if (scenario.type === 'anonymous_conflict') {
      setConflictScenario(scenario);
    } else if (scenario.type === 'restore_confirmation') {
      setRestoreConfirmationScenario(scenario);
    } else {
      refreshLegacyTotpCount((value) => value + 1);
      playSuccessSound();
      triggerConfetti();
      showToast(scenario.message || 'Signed in with Google successfully!');
      loadAllData();
    }
  };

  const finishRedirectLogin = useEffectEvent(async (user: NonNullable<typeof googleUser>) => {
    await finishGoogleLogin(user);
  });

  // Handle redirect logins on web through the same account-resolution flow as native sign-in.
  useEffect(() => {
    checkRedirectAuth()
      .then((redirectUser) => redirectUser ? finishRedirectLogin(redirectUser) : undefined)
      .catch((err) => {
        if (err instanceof TotpSignInRequiredError || err?.name === 'TotpSignInRequiredError' || Boolean(err?.challenge)) {
          setTotpSignInChallenge(err.challenge);
          showToast('Enter your authenticator code to finish Google sign-in.');
          return;
        }
        console.error('Redirect auth check error:', err);
      });
  }, []);

  // Google Sign-In & Sync handlers
  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    playPopSound();
    try {
      const user = await loginWithGoogle();
      await finishGoogleLogin(user);
    } catch (err: any) {
      console.error('Google Sign-in error:', err);
      if (err instanceof TotpSignInRequiredError || err?.name === 'TotpSignInRequiredError' || Boolean(err?.challenge)) {
        setTotpSignInChallenge(err.challenge);
        showToast('Enter your authenticator code to finish Google sign-in.');
        return;
      }
      if (err.message && err.message.includes('Redirecting to Google sign in')) {
        showToast('Redirecting to Google Sign-In...');
        return;
      }
      const friendlyMsg = getFriendlyAuthErrorMessage(err);
      playPopSound();
      showToast(friendlyMsg);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleCompleteTotpSignIn = async (code: string) => {
    const user = await completeTotpSignIn(code);
    setTotpSignInChallenge(null);
    await finishGoogleLogin(user);
    try {
      const removed = await removeFactoryLedgerTotpFactors();
      refreshLegacyTotpCount((value) => value + 1);
      if (removed > 0) showToast('Old Factory Ledger authenticator removed. Future sign-ins use Google only.');
    } catch (err) {
      console.warn('Signed in, but the old authenticator could not be removed:', err);
      refreshLegacyTotpCount((value) => value + 1);
      showToast('Signed in. Use Remove under Google Cloud Backup to detach the old authenticator.');
    }
  };

  const handleRemoveLegacyTotp = async () => {
    try {
      const removed = await removeFactoryLedgerTotpFactors();
      refreshLegacyTotpCount((value) => value + 1);
      showToast(removed > 0 ? 'Old Factory Ledger authenticator removed.' : 'No old authenticator was found.');
    } catch (err: any) {
      showToast(getFriendlyAuthErrorMessage(err));
    }
  };

  const handleGoogleSignOut = () => {
    playPopSound();
    setIsSignOutSheetOpen(true);
  };

  const handleConfirmSignOut = async (mode: 'keep_data' | 'clear_data') => {
    setIsSignOutSheetOpen(false);
    playPopSound();
    try {
      const res = await handleSignOut(mode);
      if (!res.success) {
        showToast(res.message);
        return;
      }
      showToast(res.message);
      loadAllData();
    } catch (err: any) {
      console.error('Sign out error:', err);
      showToast('Error signing out');
    }
  };

  const handleManualSync = async () => {
    if (!googleUser) {
      showToast('Please sign in with Google first');
      return;
    }
    setIsSyncing(true);
    playPopSound();
    try {
      const result = await syncNow(true);
      if (result.success) {
        playCashChime();
        showToast('All ledgers synchronized with Firebase Cloud');
      } else if (result.protected) {
        showToast('Cloud backup preserved (Local storage is empty)');
      } else {
        showToast('Cloud Sync: ' + (result.message || 'Failed to sync'));
      }
    } catch (err: any) {
      console.error('Cloud Sync error:', err);
      showToast('Cloud Sync Error: ' + (err.message || 'Failed to sync data to Firebase'));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCloudRestore = () => {
    if (!googleUser) {
      showToast('Please sign in with Google first');
      return;
    }
    setShowRestoreCloudConfirm(true);
  };

  const executeCloudRestore = async () => {
    setShowRestoreCloudConfirm(false);
    setIsRestoringFromCloud(true);
    playPopSound();
    try {
      const result = await restoreFromCloud();
      if (result.success) {
        playSuccessSound();
        triggerConfetti();
        showToast('Restored successfully from Firebase Cloud');
        loadAllData();
      } else {
        showToast(result.message || 'Failed to restore backup');
      }
    } catch (err: any) {
      console.error('Cloud restore error:', err);
      showToast('Failed to restore from Firebase Cloud: ' + (err.message || 'Error'));
    } finally {
      setIsRestoringFromCloud(false);
    }
  };

  // Image upload handlers
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsLogoUploading(true);
      const dataUrl = await processImageFile(file, { maxWidth: 400, maxHeight: 400, quality: 0.85 });
      const updated = { ...settings, logoUrl: dataUrl };
      setSettings(updated);
      await saveSettings(updated);
      playSuccessSound();
      showToast('Logo updated');
    } catch (err: any) {
      showToast(err.message || 'Failed to process logo');
    } finally {
      setIsLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleConfirmRemoveLogo = async () => {
    const updated = { ...settings, logoUrl: '' };
    setSettings(updated);
    await saveSettings(updated);
    setShowRemoveLogoConfirm(false);
    playPopSound();
    showToast('Logo removed');
  };

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsSignatureUploading(true);
      const dataUrl = await processImageFile(file, { maxWidth: 500, maxHeight: 250, quality: 0.85, preferPng: true });
      const updated = { ...settings, signatureUrl: dataUrl };
      setSettings(updated);
      await saveSettings(updated);
      playSuccessSound();
      showToast('Authorized signature updated');
    } catch (err: any) {
      showToast(err.message || 'Failed to process signature image');
    } finally {
      setIsSignatureUploading(false);
      if (signatureInputRef.current) signatureInputRef.current.value = '';
    }
  };

  const handleConfirmRemoveSignature = async () => {
    const updated = { ...settings, signatureUrl: '' };
    setSettings(updated);
    await saveSettings(updated);
    setShowRemoveSignatureConfirm(false);
    playPopSound();
    showToast('Signature removed');
  };

  // Appearance & Sound handlers
  const handleThemeChange = async (theme: 'light' | 'dark' | 'system') => {
    const updated = { ...settings, theme };
    setSettings(updated);
    await saveSettings(updated);
    const isDark =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : theme === 'dark';
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    playPopSound();
    showToast(
      theme === 'system'
        ? `Switched to System Mode (${isDark ? 'Dark' : 'Light'})`
        : theme === 'dark'
          ? 'Switched to Dark Mode'
          : 'Switched to Light Mode'
    );
  };


  /*
  const handleAccentChange = (accent: string) => {
    setActiveAccent(accent);
    localStorage.setItem('coal_accent_theme', accent);
    const root = document.documentElement;
    ['theme-emerald', 'theme-violet', 'theme-amber', 'theme-crimson'].forEach((cls) => {
      root.classList.remove(cls);
    });
    if (accent !== 'blue') {
      root.classList.add(`theme-${accent}`);
    }
    playPopSound();
    showToast(`Accent updated to ${accent.charAt(0).toUpperCase() + accent.slice(1)}`);
  };
  */
  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    localStorage.setItem('coal_sound_enabled', String(enabled));
    if (enabled) {
      playCashChime();
      showToast('Sound effects enabled');
    } else {
      showToast('Sound effects muted');
    }
  };

  // App Lock Security Handlers
  const handleToggleAppLock = async () => {
    playPopSound();
    if (appLockActive) {
      setShowDisableLockConfirm(true);
    } else {
      if (Capacitor.isNativePlatform() && !(await isDeviceLockAvailable())) {
        showToast('Set up a phone PIN, pattern, or password before enabling App Lock.');
        return;
      }
      setIsChangingPasscode(false);
      setShowPasscodeModal(true);
    }
  };

  const handleConfirmDisableLock = () => {
    setShowDisableLockConfirm(false);
    setShowVerifyPinForDisable(true);
  };

  const handlePasscodeVerifiedForDisable = async () => {
    setShowVerifyPinForDisable(false);
    disableAppLock();
    playPopSound();
    const updated = {
      ...settings,
      appLockEnabled: false,
      pinHash: '',
      pinLength: 5,
    };
    setSettings(updated);
    await saveSettings(updated);
    setAppLockActive(false);
    setBioActive(false);
    showToast('App Lock disabled on this device');
  };

  const handlePasscodeSuccess = async (withBio: boolean) => {
    setShowPasscodeModal(false);
    setAppLockActive(true);
    if (withBio) setBioActive(true);
    const pinHash = getStoredPinHash() || '';
    const pinLen = getPinLength();
    setPinLength(pinLen);
    const updated = {
      ...settings,
      appLockEnabled: true,
      pinHash,
      pinLength: pinLen,
      lockTimeout: lockTimeoutSec,
    };
    setSettings(updated);
    await saveSettings(updated);
    showToast(isChangingPasscode ? '5-Digit Passcode updated on this device' : 'App Lock activated with 5-Digit Passcode');
  };

  const handleToggleBiometrics = async () => {
    playPopSound();
    if (bioActive) {
      setBiometricEnabled(false);
      setBioActive(false);
      showToast('Fingerprint unlock disabled');
    } else {
      const regSuccess = await registerBiometrics();
      if (regSuccess) {
        setBioActive(true);
        playSuccessSound();
        showToast('Fingerprint unlock activated');
      } else {
        setBiometricEnabled(true);
        setBioActive(true);
        showToast('Fingerprint biometric enabled');
      }
    }
  };

  const handleTimeoutChange = async (sec: number) => {
    playPopSound();
    setLockTimeoutSec(sec);
    setLockTimeout(sec);
    const updated = {
      ...settings,
      lockTimeout: sec,
    };
    setSettings(updated);
    await saveSettings(updated);
    const label = sec === 0 ? 'Immediately' : sec === 60 ? 'After 1 Minute' : 'After 5 Minutes';
    showToast(`Auto-lock set to ${label}`);
  };

  // const handleTestLockNow = () => {
  //   playPopSound();
  //   lockSession();
  // };

  // Export / Import / Clear Data handlers
  const handleTriggerExport = () => {
    playPopSound();
    if (appLockActive) {
      setShowVerifyPinForExport(true);
    } else {
      executeExport();
    }
  };

  const executeExport = async () => {
    try {
      const result = await exportDatabaseBackupJson();
      setLastBackupDate(result.exportedAt);
      playSuccessSound();
      showToast(`Exported ${result.counts.parties} parties, ${result.counts.dispatches} dispatches, ${result.counts.payments} payments, ${result.counts.expenses} expenses, ${result.counts.mines} mines, ${result.counts.lots} stock lots`);
    } catch {
      showToast('Failed to generate export backup');
    }
  };

  const executeConflictArchiveExport = async () => {
    if (isExportingConflicts || conflictArchiveCount === 0) return;
    setIsExportingConflicts(true);
    try {
      const count = await exportSyncConflictHistoryJson();
      playSuccessSound();
      showToast(`Exported ${count} recoverable conflict record${count === 1 ? '' : 's'}.`);
    } catch (err: any) {
      showToast(`Conflict archive export failed: ${err?.message || 'Operation failed'}`);
    } finally {
      setIsExportingConflicts(false);
    }
  };

  const handleExportConflictArchive = () => {
    if (isExportingConflicts || conflictArchiveCount === 0) return;
    playPopSound();
    if (appLockActive) {
      setShowVerifyPinForConflictExport(true);
    } else {
      executeConflictArchiveExport();
    }
  };

  const handleClearConflictArchive = async () => {
    try {
      await clearSyncConflictHistory();
      setConflictArchiveCount(0);
      setShowClearConflictArchiveConfirm(false);
      showToast('Conflict recovery archive cleared.');
    } catch (err: any) {
      showToast(`Could not clear conflict archive: ${err?.message || 'Operation failed'}`);
    }
  };

  const handleTriggerImport = () => {
    playPopSound();
    if (appLockActive) {
      setShowVerifyPinForImport(true);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      const validation = validateBackupPayload(json);
      if (!validation.valid) {
        showToast(`Invalid backup file: ${validation.error}`);
        return;
      }

      setPendingImportFile({ name: file.name, data: json });
      setShowImportConfirmModal(true);
    } catch {
      showToast('Failed to parse backup file. Please select a valid JSON file.');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmImport = async (mode: 'replace' | 'merge') => {
    if (!pendingImportFile) return;
    setShowImportConfirmModal(false);

    try {
      if (mode === 'replace') {
        const result = await restoreBackup(pendingImportFile.data);
        if (result.success) {
          const importedDate = pendingImportFile.data.exportedAt || pendingImportFile.data.exportDate || pendingImportFile.data.createdAt;
          if (importedDate && typeof localStorage !== 'undefined' && !localStorage.getItem('fl_last_backup_date')) {
            localStorage.setItem('fl_last_backup_date', importedDate);
            setLastBackupDate(importedDate);
          }
          playSuccessSound();
          triggerConfetti();
          showToast('Database replaced cleanly from backup!');
          await loadAllData();
        } else {
          showToast(`Restore Failed: ${result.message}`);
        }
      } else {
        const currentLocal = await getAllBackupData();
        const tombstones = getTombstones();
        const { merged } = mergeLedgerData(currentLocal, pendingImportFile.data, tombstones);
        const result = await restoreBackup(merged);
        if (result.success) {
          playSuccessSound();
          triggerConfetti();
          showToast('Records merged successfully (latest updates preserved).');
          await loadAllData();
        } else {
          showToast(`Merge Failed: ${result.message}`);
        }
      }
    } catch (err: any) {
      showToast(`Import error: ${err?.message || 'Operation failed'}`);
    } finally {
      setPendingImportFile(null);
    }
  };

  const handleConfirmRollback = async () => {
    setShowRollbackConfirm(false);
    setIsRollingBack(true);
    playPopSound();
    try {
      const result = await rollbackToPreRestoreSnapshot();
      if (result.success) {
        playSuccessSound();
        triggerConfetti();
        showToast('Database rolled back to pre-restore snapshot!');
        await loadAllData();
      } else {
        showToast(`Rollback Failed: ${result.message}`);
      }
    } catch (err: any) {
      showToast(`Rollback error: ${err?.message || 'Operation failed'}`);
    } finally {
      setIsRollingBack(false);
    }
  };

  const handleConfirmClear = async () => {
    await clearAllData();
    setShowClearConfirm(false);
    window.location.reload();
  };

  const handleClearDeviceOnly = async () => {
    setShowSignedInClearModal(false);
    await clearAllData({ resetSettings: true, resetOwner: true });
    await logoutUser();
    window.location.reload();
  };

  const handleClearCloudAndDevice = async () => {
    setShowSignedInClearModal(false);
    if (googleUser?.uid) {
      const wipeResult = await wipeCloudUserData(googleUser.uid);
      if (!wipeResult.success) {
        showToast(`Cloud data was not deleted. Your device ledger has been kept safe: ${wipeResult.message}`);
        return;
      }
    }
    await clearAllData({ resetSettings: true, resetOwner: true });
    await logoutUser();
    window.location.reload();
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--label-secondary)', fontSize: 15 }}>
        Loading settings…
      </div>
    );
  }

  return (
    <div className="ios-fade-in" style={{ paddingBottom: 48 }}>
      {/* Toast Notification (Issue 28f: Full screen mobile width + centered) */}
      {toastMessage && (
        <div className="ios-toast-banner">
          <Check size={16} strokeWidth={3} style={{ color: 'var(--ios-green)' }} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input type="file" ref={fileInputRef} onChange={handleImportFile} accept=".json" style={{ display: 'none' }} />
      <input type="file" ref={logoInputRef} onChange={handleLogoUpload} accept="image/*" style={{ display: 'none' }} />
      <input type="file" ref={signatureInputRef} onChange={handleSignatureUpload} accept="image/*" style={{ display: 'none' }} />

      {/* ── iOS Navigation Header with Large Title ── */}
      <div className="ios-large-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 className="ios-large-title">Settings</h1>
        {saved && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 8,
              background: 'var(--ios-green)',
            }}
          >
            <Check size={13} strokeWidth={3} />
            Saved
          </span>
        )}
      </div>

      {/* ── Apple ID / Business Profile Banner Card ── */}
      <div className="ios-group" style={{ marginTop: 6, marginBottom: 14 }}>
        <div className="ios-card-grouped" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            onClick={() => logoInputRef.current?.click()}
            title="Tap to change logo"
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: settings.logoUrl ? 'var(--fill-tertiary)' : 'var(--ios-blue)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 24,
              flexShrink: 0,
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
              border: '2px solid var(--separator-opaque)',
            }}
          >
            {isLogoUploading ? (
              <Loader2 className="animate-spin" style={{ width: 24, height: 24, color: 'var(--ios-blue)' }} />
            ) : settings.logoUrl ? (
              <img src={settings.logoUrl} alt="Company Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              settings.userName?.charAt(0)?.toUpperCase() || 'T'
            )}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 20,
                background: 'rgba(0, 0, 0, 0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Camera style={{ width: 12, height: 12, color: '#FFFFFF' }} />
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)', letterSpacing: '-0.2px' }}>
              {settings.userName || 'Coal Trader'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--label-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {settings.businessName || 'Apex Coal Logistics'} {settings.phoneNumber ? `· ${settings.phoneNumber}` : ''}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'white',
                  background: 'var(--ios-blue)',
                  padding: '2px 8px',
                  borderRadius: 6,
                }}
              >
                {settings.accountType || 'Commercial Account'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: googleUser ? 'white' : 'var(--label-tertiary)',
                  background: googleUser ? 'var(--ios-green)' : 'var(--fill-tertiary)',
                  padding: '2px 8px',
                  borderRadius: 6,
                }}
              >
                {googleUser ? 'Cloud Synced' : `${stats.dispatches} Trucks`}
              </span>
            </div>
          </div>
        </div>
      </div>



      {/* ── ACCORDION 1: Google Account & Cloud Sync ── */}
      <div className="ios-group" style={{ marginBottom: 14 }}>
        <div className="ios-card-grouped" style={{ overflow: 'hidden' }}>
          <div
            className="ios-cell"
            onClick={() => toggleSection('google')}
            style={{
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '13px 16px',
              minHeight: 54,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div
                className="ios-glyph-badge"
                style={{
                  background: 'var(--fill-tertiary)',
                  border: '0.5px solid var(--separator-opaque)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <GoogleLogo size={18} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', letterSpacing: '-0.2px' }}>
                  Google Account
                </span>
                {!openSections['google'] && (
                  <span
                    style={{
                      fontSize: 12,
                      color: googleUser ? 'var(--ios-green)' : 'var(--label-secondary)',
                      marginTop: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {googleUser ? `${googleUser.email}` : 'Sign in for Firebase Cloud Sync'}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {!openSections['google'] && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 10,
                    background: googleUser ? 'var(--ios-green)' : !isFirebaseConfigured ? 'var(--fill-tertiary)' : 'var(--fill-tertiary)',
                    color: googleUser ? '#FFFFFF' : 'var(--label-secondary)',
                  }}
                >
                  {googleUser ? 'Signed IN' : !isFirebaseConfigured ? 'Offline Only' : 'Not Linked'}
                </span>
              )}
              <ChevronDown
                style={{
                  width: 18,
                  height: 18,
                  color: 'var(--label-tertiary)',
                  transform: openSections['google'] ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                strokeWidth={2.4}
              />
            </div>
            {openSections['google'] && <div className="ios-separator with-glyph" />}
          </div>

          {openSections['google'] && (
            <div>
              {!isFirebaseConfigured ? (
                /* Offline-Only Mode (No Firebase Credentials) */
                <div style={{ padding: '20px 16px 16px' }}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      padding: '20px 16px',
                      background: 'var(--fill-quaternary)',
                      borderRadius: 14,
                      border: '0.5px solid var(--separator-opaque)',
                    }}
                  >
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: '50%',
                        background: 'var(--bg-card)',
                        border: '0.5px solid var(--separator-opaque)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 12,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                        color: 'var(--ios-blue)',
                      }}
                    >
                      <CloudOff size={24} />
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)', marginBottom: 6 }}>
                      Offline-Only Mode Active
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--label-secondary)', lineHeight: 1.45, maxWidth: 340, marginBottom: 12 }}>
                      All financial records and ledger data are securely stored locally on this device in high-capacity IndexedDB.
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--label-tertiary)',
                        lineHeight: 1.4,
                        maxWidth: 340,
                        background: 'var(--bg-card)',
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: '0.5px solid var(--separator)',
                      }}
                    >
                      To enable Google Sign-In and multi-device cloud synchronization, configure your Firebase project credentials in your <code>.env</code> file.
                    </div>
                  </div>
                </div>
              ) : !googleUser ? (
                /* Not Signed In */
                <div style={{ padding: '20px 16px 16px' }}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      padding: '16px 12px 20px',
                      background: 'var(--fill-quaternary)',
                      borderRadius: 14,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: '50%',
                        background: 'var(--bg-card)',
                        border: '0.5px solid var(--separator-opaque)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 12,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                      }}
                    >
                      <GoogleLogo size={26} />
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)', marginBottom: 6 }}>
                      Sign In with Google
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--label-secondary)', lineHeight: 1.45, maxWidth: 320 }}>
                      Connect your Google Account to back up dispatches and parties automatically with Firebase Cloud.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isSigningIn}
                    style={{
                      width: '100%',
                      height: 50,
                      borderRadius: 12,
                      border: '0.5px solid var(--separator-opaque)',
                      background: 'var(--bg-card)',
                      color: 'var(--label-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: isSigningIn ? 'not-allowed' : 'pointer',
                      opacity: isSigningIn ? 0.75 : 1,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    }}
                  >
                    {isSigningIn ? (
                      <>
                        <Loader2 className="animate-spin" style={{ width: 19, height: 19, color: 'var(--ios-blue)' }} />
                        <span>Signing in with Google…</span>
                      </>
                    ) : (
                      <>
                        <GoogleLogo size={20} />
                        <span>Sign in with Google</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                /* Signed In */
                <div>
                  <div className="ios-cell" style={{ cursor: 'default', padding: '14px 16px' }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        background: 'var(--ios-blue)',
                        color: '#FFFFFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                        fontWeight: 700,
                        marginRight: 12,
                        flexShrink: 0,
                        overflow: 'hidden',
                      }}
                    >
                      {googleUser.photoUrl ? (
                        <img src={googleUser.photoUrl} alt="Google Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        googleUser.displayName?.charAt(0) || 'G'
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)' }}>
                          {googleUser.displayName}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 6,
                            background: !isOnline
                              ? 'rgba(255, 149, 0, 0.15)'
                              : syncStatus === 'error'
                                ? 'rgba(255, 59, 48, 0.15)'
                                : syncStatus === 'syncing' || isSyncing
                                  ? 'rgba(0, 122, 255, 0.15)'
                                  : 'rgba(52, 199, 89, 0.15)',
                            color: !isOnline
                              ? 'var(--ios-orange)'
                              : syncStatus === 'error'
                                ? 'var(--ios-red)'
                                : syncStatus === 'syncing' || isSyncing
                                  ? 'var(--ios-blue)'
                                  : 'var(--ios-green)',
                            textTransform: 'uppercase',
                          }}
                        >
                          {!isOnline ? 'Offline' : syncStatus === 'syncing' || isSyncing ? 'Syncing…' : 'Synced'}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--label-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {googleUser.email}
                      </div>
                    </div>
                    <div className="ios-separator with-glyph" />
                  </div>

                  <div className="ios-cell" style={{ alignItems: 'flex-start', padding: '14px 16px' }}>
                    <div className="ios-glyph-badge" style={{ background: legacyTotpCount > 0 ? 'var(--ios-orange)' : 'var(--ios-green)', marginTop: 1 }}>
                      <ShieldCheck size={18} color="#FFFFFF" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="ios-cell-label">Google Cloud Backup</span>
                      <div style={{ fontSize: 12, color: 'var(--label-secondary)', lineHeight: 1.4, marginTop: 2 }}>
                        {legacyTotpCount > 0
                          ? 'An old Factory Ledger authenticator is still attached. Remove it to simplify future sign-ins.'
                          : 'Cloud access follows this Google account. Phone Lock protects only this device.'}
                      </div>
                    </div>
                    {legacyTotpCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => void handleRemoveLegacyTotp()}
                        style={{ minHeight: 44, border: 0, borderRadius: 12, padding: '0 12px', background: 'var(--fill-tertiary)', color: 'var(--ios-red)', fontWeight: 650, cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    ) : (
                      <Check size={20} color="var(--ios-green)" style={{ marginTop: 2 }} />
                    )}
                    <div className="ios-separator with-glyph" />
                  </div>

                  {/* Auto Sync Toggle */}
                  <div
                    className="ios-cell"
                    onClick={() => {
                      playPopSound();
                      const next = !autoSyncEnabled;
                      setAutoSyncEnabled(next);
                      showToast(next ? 'Cloud Sync enabled' : 'Cloud Sync paused');
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="ios-glyph-badge" style={{ background: 'var(--ios-blue)' }}>
                      <RefreshCw size={18} color="#FFFFFF" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <span className="ios-cell-label">Automatic Cloud Backup</span>
                      <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
                        Write-through sync on every entry
                      </div>
                    </div>
                    <div
                      style={{
                        width: 51,
                        height: 31,
                        borderRadius: 31,
                        background: autoSyncEnabled ? 'var(--ios-green)' : 'var(--fill-primary)',
                        position: 'relative',
                        transition: 'background 0.25s ease',
                      }}
                    >
                      <div
                        style={{
                          width: 27,
                          height: 27,
                          borderRadius: '50%',
                          background: '#FFFFFF',
                          position: 'absolute',
                          top: 2,
                          left: autoSyncEnabled ? 22 : 2,
                          boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                          transition: 'left 0.25s ease',
                        }}
                      />
                    </div>
                    <div className="ios-separator with-glyph" />
                  </div>

                  {/* Manual Sync Row */}
                  <div className="ios-cell" onClick={handleManualSync} style={{ cursor: isSyncing ? 'default' : 'pointer' }}>
                    <div className="ios-glyph-badge" style={{ background: 'var(--ios-teal)' }}>
                      <RefreshCw className={isSyncing ? 'animate-spin' : ''} size={18} color="#FFFFFF" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="ios-cell-label">Back Up to Cloud</span>
                      <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
                        {isSyncing
                          ? 'Syncing with Firebase…'
                          : unresolvedCount && unresolvedCount > 0
                            ? `${unresolvedCount} item(s) could not sync with cloud`
                            : hasPendingChanges
                              ? 'Local changes waiting to sync'
                              : lastSyncTime
                                ? `Last: ${new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                : 'Upload ledgers to Firebase'}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isSyncing}
                      style={{
                        border: 'none',
                        background: 'var(--ios-blue)',
                        color: '#FFFFFF',
                        padding: '6px 14px',
                        borderRadius: 14,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: isSyncing ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isSyncing ? 'Syncing…' : 'Sync Now'}
                    </button>
                    <div className="ios-separator with-glyph" />
                  </div>

                  {/* Restore from Cloud Row */}
                  <div className="ios-cell" onClick={handleCloudRestore} style={{ cursor: isRestoringFromCloud ? 'default' : 'pointer' }}>
                    <div className="ios-glyph-badge" style={{ background: 'var(--ios-purple)' }}>
                      <Download size={18} color="#FFFFFF" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="ios-cell-label">Restore from Cloud</span>
                      <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
                        Download saved data from Firebase
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isRestoringFromCloud}
                      style={{
                        border: 'none',
                        background: 'var(--fill-tertiary)',
                        color: 'var(--label-primary)',
                        padding: '6px 14px',
                        borderRadius: 14,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: isRestoringFromCloud ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isRestoringFromCloud ? 'Restoring…' : 'Restore'}
                    </button>
                    <div className="ios-separator with-glyph" />
                  </div>

                  {/* Sign Out Row */}
                  <div className="ios-cell" onClick={handleGoogleSignOut} style={{ cursor: 'pointer' }}>
                    <div className="ios-glyph-badge" style={{ background: 'var(--ios-red)' }}>
                      <LogOut size={18} color="#FFFFFF" />
                    </div>
                    <span className="ios-cell-label" style={{ color: 'var(--ios-red)' }}>
                      Sign Out of Google
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── ACCORDION 2: Business Profile & Invoicing ── */}
      <div className="ios-group" style={{ marginBottom: 14 }}>
        <div className="ios-card-grouped" style={{ overflow: 'hidden' }}>
          <div
            className="ios-cell"
            onClick={() => toggleSection('business')}
            style={{
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '13px 16px',
              minHeight: 54,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div className="ios-glyph-badge" style={{ background: 'var(--ios-blue)', flexShrink: 0 }}>
                <Building2 size={18} color="#FFFFFF" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', letterSpacing: '-0.2px' }}>
                  Business Profile & Branding
                </span>
                {!openSections['business'] && (
                  <span style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {settings.businessName || 'Trader Name, NTN & Signatures'}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <ChevronDown
                style={{
                  width: 18,
                  height: 18,
                  color: 'var(--label-tertiary)',
                  transform: openSections['business'] ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                strokeWidth={2.4}
              />
            </div>
            {openSections['business'] && <div className="ios-separator with-glyph" />}
          </div>

          {openSections['business'] && (
            <form onSubmit={handleSave}>
              {/* Trader Name */}
              <div className="ios-cell" style={{ cursor: 'default' }}>
                <div className="ios-glyph-badge" style={{ background: 'var(--ios-blue)' }}>
                  <User size={18} color="#FFFFFF" />
                </div>
                <span className="ios-cell-label">Trader Name</span>
                <input
                  type="text"
                  value={settings.userName}
                  onChange={(e) => handleChange('userName', e.target.value)}
                  onBlur={handleAutoSave}
                  placeholder="Your name"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: 16,
                    textAlign: 'right',
                    color: 'var(--label-primary)',
                    outline: 'none',
                    maxWidth: 200,
                  }}
                />
                <div className="ios-separator with-glyph" />
              </div>

              {/* Business Name */}
              <div className="ios-cell" style={{ cursor: 'default' }}>
                <div className="ios-glyph-badge" style={{ background: 'var(--ios-orange)' }}>
                  <Building2 size={18} color="#FFFFFF" />
                </div>
                <span className="ios-cell-label">Business Name</span>
                <input
                  type="text"
                  value={settings.businessName}
                  onChange={(e) => handleChange('businessName', e.target.value)}
                  onBlur={handleAutoSave}
                  placeholder="Enterprise name"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: 16,
                    textAlign: 'right',
                    color: 'var(--label-primary)',
                    outline: 'none',
                    maxWidth: 200,
                  }}
                />
                <div className="ios-separator with-glyph" />
              </div>

              {/* Account Category Selector (Custom iOS Dropdown) */}
              <div style={{ position: 'relative' }}>
                <IOSSelect
                  glyphBadge={
                    <div className="ios-glyph-badge" style={{ background: 'var(--ios-purple)' }}>
                      <Briefcase size={18} color="#FFFFFF" />
                    </div>
                  }
                  label="Trade Entity"
                  description="Shows on statements"
                  value={settings.accountType || 'Commercial Coal Trader'}
                  onChange={async (val) => {
                    handleChange('accountType', val);
                    await saveSettings({ ...settings, accountType: val });
                    showToast(`Entity set to ${val}`);
                  }}
                  options={ACCOUNT_TYPE_OPTIONS}
                  title="Select Business Entity Type"
                  searchable={false}
                />
                <div className="ios-separator with-glyph" />
              </div>

              {/* Direct Phone */}
              <div className="ios-cell" style={{ cursor: 'default' }}>
                <div className="ios-glyph-badge" style={{ background: 'var(--ios-green)' }}>
                  <Phone size={18} color="#FFFFFF" />
                </div>
                <span className="ios-cell-label">Direct Phone</span>
                <input
                  type="tel"
                  value={settings.phoneNumber}
                  onChange={(e) => handleChange('phoneNumber', e.target.value)}
                  onBlur={handleAutoSave}
                  placeholder="0300-1234567"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: 16,
                    textAlign: 'right',
                    color: 'var(--label-primary)',
                    outline: 'none',
                    maxWidth: 200,
                  }}
                />
                <div className="ios-separator with-glyph" />
              </div>

              {/* Office / Yard Address */}
              <div className="ios-cell" style={{ cursor: 'default' }}>
                <div className="ios-glyph-badge" style={{ background: 'var(--ios-teal)' }}>
                  <MapPin size={18} color="#FFFFFF" />
                </div>
                <span className="ios-cell-label">Address</span>
                <input
                  type="text"
                  value={settings.companyAddress || ''}
                  onChange={(e) => handleChange('companyAddress', e.target.value)}
                  onBlur={handleAutoSave}
                  placeholder="Address or Plot #"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: 16,
                    textAlign: 'right',
                    color: 'var(--label-primary)',
                    outline: 'none',
                    maxWidth: 200,
                  }}
                />
                <div className="ios-separator with-glyph" />
              </div>

              {/* Company Logo Row */}
              <div
                className="ios-cell"
                onClick={() => {
                  if (!settings.logoUrl && !isLogoUploading) {
                    logoInputRef.current?.click();
                  }
                }}
                style={{ cursor: settings.logoUrl ? 'default' : 'pointer' }}
              >
                <div className="ios-glyph-badge" style={{ background: 'var(--ios-red)' }}>
                  <Image size={18} color="#FFFFFF" />
                </div>
                <div style={{ flex: 1 }}>
                  <span className="ios-cell-label">Company Logo</span>
                  <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>Vouchers & PDF receipts</div>
                </div>

                {settings.logoUrl || isLogoUploading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        logoInputRef.current?.click();
                      }}
                      title="Change logo"
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 10,
                        border: '1px solid var(--separator-opaque)',
                        background: 'var(--fill-tertiary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        cursor: 'pointer',
                      }}
                    >
                      {settings.logoUrl && (
                        <img src={settings.logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      )}
                      {isLogoUploading && <Loader2 className="animate-spin" size={18} color="var(--ios-blue)" />}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playPopSound();
                        setShowRemoveLogoConfirm(true);
                      }}
                      title="Remove logo"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'rgba(255, 59, 48, 0.1)',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: 'var(--ios-red)',
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--ios-blue)',
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Upload
                  </button>
                )}
                <div className="ios-separator with-glyph" />
              </div>

              {/* Authorized Signature Row */}
              <div
                className="ios-cell"
                onClick={() => {
                  if (!settings.signatureUrl && !isSignatureUploading) {
                    signatureInputRef.current?.click();
                  }
                }}
                style={{ cursor: settings.signatureUrl ? 'default' : 'pointer' }}
              >
                <div className="ios-glyph-badge" style={{ background: 'var(--ios-purple)' }}>
                  <PenLine size={18} color="#FFFFFF" />
                </div>
                <div style={{ flex: 1 }}>
                  <span className="ios-cell-label">Authorized Signature</span>
                  <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>Stamped dispatch bills</div>
                </div>

                {settings.signatureUrl || isSignatureUploading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        signatureInputRef.current?.click();
                      }}
                      title="Change signature"
                      style={{
                        width: 52,
                        height: 38,
                        borderRadius: 10,
                        border: '1px solid var(--separator-opaque)',
                        background: 'var(--fill-tertiary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        cursor: 'pointer',
                      }}
                    >
                      {settings.signatureUrl && (
                        <img src={settings.signatureUrl} alt="Signature" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      )}
                      {isSignatureUploading && <Loader2 className="animate-spin" size={18} color="var(--ios-blue)" />}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playPopSound();
                        setShowRemoveSignatureConfirm(true);
                      }}
                      title="Remove signature"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'rgba(255, 59, 48, 0.1)',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: 'var(--ios-red)',
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => signatureInputRef.current?.click()}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--ios-blue)',
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Upload
                  </button>
                )}
              </div>

              {/* Save Button */}
              <div style={{ padding: '12px 16px', background: 'var(--bg-card)' }}>
                <button type="submit" className="ios-btn ios-btn-primary" style={{ width: '100%' }}>
                  {saved ? 'Changes Saved!' : 'Save Business Profile'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* ── ACCORDION 3: Security & App Lock (Fingerprint + Passcode) ── */}
      <div className="ios-group" style={{ marginBottom: 14 }}>
        <div className="ios-card-grouped" style={{ overflow: 'hidden' }}>
          <div
            className="ios-cell"
            onClick={() => toggleSection('security')}
            style={{
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '13px 16px',
              minHeight: 54,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div className="ios-glyph-badge" style={{ background: 'var(--ios-indigo)', flexShrink: 0 }}>
                {appLockActive ? <Fingerprint size={19} /> : <Lock size={18} />}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', letterSpacing: '-0.2px' }}>
                  Security & App Lock
                </span>
                {!openSections['security'] && (
                  <span style={{ fontSize: 12, color: appLockActive ? 'var(--ios-green)' : 'var(--label-secondary)', marginTop: 1 }}>
                    {appLockActive
                      ? bioActive
                        ? `Active · ${pinLength}-Digit PIN + Fingerprint Unlock`
                        : `Active · ${pinLength}-Digit Passcode PIN`
                      : 'Disabled · Protect ledgers with 5-digit PIN'}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {!openSections['security'] && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 10,
                    background: appLockActive ? 'var(--ios-green)' : 'var(--fill-tertiary)',
                    color: appLockActive ? '#FFFFFF' : 'var(--label-secondary)',
                  }}
                >
                  {appLockActive ? 'Locked' : 'Off'}
                </span>
              )}
              <ChevronDown
                style={{
                  width: 18,
                  height: 18,
                  color: 'var(--label-tertiary)',
                  transform: openSections['security'] ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                strokeWidth={2.4}
              />
            </div>
            {openSections['security'] && <div className="ios-separator with-glyph" />}
          </div>

          {openSections['security'] && (
            <div>
              {/* Require App Lock Toggle */}
              <div className="ios-cell" onClick={() => { void handleToggleAppLock(); }} style={{ cursor: 'pointer' }}>
                <div className="ios-glyph-badge" style={{ background: appLockActive ? 'var(--ios-green)' : 'var(--fill-secondary)' }}>
                  <Lock size={18} color="#FFFFFF" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="ios-cell-label">Require App Passcode</span>
                  <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
                    Locks app when closed or backgrounded
                  </div>
                </div>
                {/* iOS Switch */}
                <div
                  style={{
                    width: 51,
                    height: 31,
                    borderRadius: 31,
                    background: appLockActive ? 'var(--ios-green)' : 'var(--fill-primary)',
                    position: 'relative',
                    transition: 'background 0.25s ease',
                  }}
                >
                  <div
                    style={{
                      width: 27,
                      height: 27,
                      borderRadius: '50%',
                      background: '#FFFFFF',
                      position: 'absolute',
                      top: 2,
                      left: appLockActive ? 22 : 2,
                      boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                      transition: 'left 0.25s ease',
                    }}
                  />
                </div>
                <div className="ios-separator with-glyph" />
              </div>

              {appLockActive && (
                <>
                  {/* Fingerprint / Biometric Toggle */}
                  <div className="ios-cell" onClick={handleToggleBiometrics} style={{ cursor: 'pointer' }}>
                    <div className="ios-glyph-badge" style={{ background: 'var(--ios-blue)' }}>
                      <Fingerprint size={19} color="#FFFFFF" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="ios-cell-label">Fingerprint / Biometric Unlock</span>
                      <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
                        {isBioHardwareAvailable ? 'Device sensor available' : 'Biometric authentication on supported devices'}
                      </div>
                    </div>
                    {/* iOS Switch */}
                    <div
                      style={{
                        width: 51,
                        height: 31,
                        borderRadius: 31,
                        background: bioActive ? 'var(--ios-green)' : 'var(--fill-primary)',
                        position: 'relative',
                        transition: 'background 0.25s ease',
                      }}
                    >
                      <div
                        style={{
                          width: 27,
                          height: 27,
                          borderRadius: '50%',
                          background: '#FFFFFF',
                          position: 'absolute',
                          top: 2,
                          left: bioActive ? 22 : 2,
                          boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                          transition: 'left 0.25s ease',
                        }}
                      />
                    </div>
                    <div className="ios-separator with-glyph" />
                  </div>

                  {/* Change / Upgrade Passcode Row */}
                  <div
                    className="ios-cell"
                    onClick={() => {
                      playPopSound();
                      setIsChangingPasscode(true);
                      setShowPasscodeModal(true);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="ios-glyph-badge" style={{ background: pinLength === 4 ? '#FF9F0A' : 'var(--ios-orange)' }}>
                      <ShieldCheck size={18} color="#FFFFFF" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="ios-cell-label">
                        {pinLength === 4 ? 'Upgrade to 5-Digit Passcode' : 'Change 5-Digit Passcode'}
                      </span>
                      <div style={{ fontSize: 12, color: pinLength === 4 ? '#FF9F0A' : 'var(--label-secondary)', marginTop: 1 }}>
                        {pinLength === 4 ? 'Using legacy 4-digit PIN · Tap to upgrade to 5 digits' : 'Protects Factory Ledger on this device'}
                      </div>
                    </div>
                    <span style={{ fontSize: 14, color: 'var(--ios-blue)', fontWeight: 600 }}>
                      {pinLength === 4 ? 'Upgrade' : 'Update'}
                    </span>
                    <div className="ios-separator with-glyph" />
                  </div>

                  {/* Auto-Lock Timeout Row */}
                  <div className="ios-cell" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="ios-glyph-badge" style={{ background: 'var(--ios-teal)' }}>
                          <Sliders size={18} color="#FFFFFF" />
                        </div>
                        <div>
                          <div className="ios-cell-label">Auto-Lock Interval</div>
                          <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>Lock app when inactive</div>
                        </div>
                      </div>
                    </div>
                    {/* Segmented Picker */}
                    <div
                      style={{
                        width: '100%',
                        display: 'flex',
                        background: 'var(--fill-tertiary)',
                        borderRadius: 10,
                        padding: 3,
                        gap: 4,
                      }}
                    >
                      {[
                        { sec: 0, label: 'Immediately' },
                        { sec: 60, label: '1 Minute' },
                        { sec: 300, label: '5 Minutes' },
                      ].map((item) => {
                        const active = lockTimeoutSec === item.sec;
                        return (
                          <button
                            key={item.sec}
                            type="button"
                            onClick={() => handleTimeoutChange(item.sec)}
                            style={{
                              flex: 1,
                              padding: '7px 4px',
                              borderRadius: 8,
                              border: 'none',
                              background: active ? 'var(--bg-card)' : 'transparent',
                              color: active ? 'var(--label-primary)' : 'var(--label-secondary)',
                              fontSize: 13,
                              fontWeight: active ? 600 : 500,
                              cursor: 'pointer',
                              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                            }}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="ios-separator with-glyph" style={{ marginTop: 8 }} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── ACCORDION 4: Materials & Pricing ── */}
      <div className="ios-group" style={{ marginBottom: 14 }}>
        <div className="ios-card-grouped" style={{ overflow: 'hidden' }}>
          <div
            className="ios-cell"
            onClick={() => toggleSection('materials')}
            style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', minHeight: 54 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div className="ios-glyph-badge" style={{ background: 'var(--ios-orange)', flexShrink: 0 }}>
                <Layers size={18} color="#FFFFFF" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', letterSpacing: '-0.2px' }}>
                  Material Catalogue
                </span>
                {!openSections['materials'] && (
                  <span style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
                    {(settings.materialItems?.filter((item) => item.isActive !== false).length || 4)} active materials
                  </span>
                )}
              </div>
            </div>
            <ChevronDown
              style={{ width: 18, height: 18, color: 'var(--label-tertiary)', transform: openSections['materials'] ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}
              strokeWidth={2.4}
            />
            {openSections['materials'] && <div className="ios-separator with-glyph" />}
          </div>
          {openSections['materials'] && (
            <MaterialSettingsPanel
              settings={settings}
              onSave={async (nextSettings) => {
                await saveSettings(nextSettings);
                setSettings(nextSettings);
                showToast('Material catalogue saved');
              }}
            />
          )}
        </div>
      </div>

      {/* ── ACCORDION 5: Appearance & Sound ── */}
      <div className="ios-group" style={{ marginBottom: 14 }}>
        <div className="ios-card-grouped" style={{ overflow: 'hidden' }}>
          <div
            className="ios-cell"
            onClick={() => toggleSection('appearance')}
            style={{
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '13px 16px',
              minHeight: 54,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div className="ios-glyph-badge" style={{ background: 'var(--ios-indigo)', flexShrink: 0 }}>
                <Moon size={18} color="#FFFFFF" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', letterSpacing: '-0.2px' }}>
                  Appearance & Sound
                </span>
                {!openSections['appearance'] && (
                  <span style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
                    {settings.theme === 'system'
                      ? `System (${systemPrefersDark ? 'Dark' : 'Light'})`
                      : settings.theme === 'dark'
                        ? 'Dark Mode'
                        : 'Light Mode'}{' '}
                    · {soundEnabled ? 'Audio Chimes On' : 'Muted'}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <ChevronDown
                style={{
                  width: 18,
                  height: 18,
                  color: 'var(--label-tertiary)',
                  transform: openSections['appearance'] ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                strokeWidth={2.4}
              />
            </div>
            {openSections['appearance'] && <div className="ios-separator with-glyph" />}
          </div>

          {openSections['appearance'] && (
            <div>
              {/* iOS 18 Segmented Theme Switcher */}
              <div style={{ padding: '16px 16px 12px', background: 'var(--bg-card)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)', marginBottom: 8 }}>
                  DISPLAY THEME
                </div>
                <div
                  style={{
                    display: 'flex',
                    background: 'var(--fill-tertiary)',
                    borderRadius: 12,
                    padding: 3,
                    gap: 4,
                  }}
                >
                  {[
                    { id: 'system', label: 'System', icon: Smartphone },
                    { id: 'light', label: 'Light', icon: Sun },
                    { id: 'dark', label: 'Dark', icon: Moon },
                  ].map((item) => {
                    const active = settings.theme === item.id;
                    const IconComp = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleThemeChange(item.id as any)}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          padding: '9px 6px',
                          borderRadius: 9,
                          border: 'none',
                          background: active ? 'var(--bg-card)' : 'transparent',
                          color: active ? 'var(--label-primary)' : 'var(--label-secondary)',
                          fontSize: 14,
                          fontWeight: active ? 600 : 500,
                          cursor: 'pointer',
                          boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        }}
                      >
                        <IconComp size={16} color={active ? 'var(--ios-blue)' : 'inherit'} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sound & Haptics */}
              <div className="ios-cell" style={{ cursor: 'pointer' }} onClick={() => handleSoundToggle(!soundEnabled)}>
                <div className="ios-glyph-badge" style={{ background: soundEnabled ? 'var(--ios-green)' : 'var(--fill-secondary)' }}>
                  {soundEnabled ? <Volume2 size={18} color="#FFFFFF" /> : <VolumeX size={18} color="var(--label-secondary)" />}
                </div>
                <div style={{ flex: 1 }}>
                  <span className="ios-cell-label">Sound & Haptics</span>
                  <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>Audio feedback on ledger actions</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {soundEnabled && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playCashChime();
                      }}
                      style={{
                        border: 'none',
                        background: 'var(--ios-blue)',
                        color: 'white',
                        padding: '4px 10px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Test Chime
                    </button>
                  )}
                  <div
                    style={{
                      width: 51,
                      height: 31,
                      borderRadius: 31,
                      background: soundEnabled ? 'var(--ios-green)' : 'var(--fill-primary)',
                      position: 'relative',
                      transition: 'background 0.25s ease',
                    }}
                  >
                    <div
                      style={{
                        width: 27,
                        height: 27,
                        borderRadius: '50%',
                        background: '#FFFFFF',
                        position: 'absolute',
                        top: 2,
                        left: soundEnabled ? 22 : 2,
                        boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                        transition: 'left 0.25s ease',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── ACCORDION 6: Currency, Region & Defaults (FUNCTIONAL DUMMY FIELDS) ── */}
      <div className="ios-group" style={{ marginBottom: 14 }}>
        <div className="ios-card-grouped" style={{ overflow: 'hidden' }}>
          <div
            className="ios-cell"
            onClick={() => toggleSection('currency')}
            style={{
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '13px 16px',
              minHeight: 54,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div className="ios-glyph-badge" style={{ background: 'var(--ios-green)', flexShrink: 0 }}>
                <Coins size={18} color="#FFFFFF" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', letterSpacing: '-0.2px' }}>
                  Currency & Number Standards
                </span>
                {!openSections['currency'] && (
                  <span style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
                    {settings.currency || 'PKR (Rs.)'} · {settings.numberFormat === 'lakh' ? 'Lakhs' : 'Millions'}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <ChevronDown
                style={{
                  width: 18,
                  height: 18,
                  color: 'var(--label-tertiary)',
                  transform: openSections['currency'] ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                strokeWidth={2.4}
              />
            </div>
            {openSections['currency'] && <div className="ios-separator with-glyph" />}
          </div>

          {openSections['currency'] && (
            <div>
              {/* Operating Currency Picker (Custom iOS Dropdown) */}
              <div style={{ position: 'relative' }}>
                <IOSSelect
                  glyphBadge={
                    <div className="ios-glyph-badge" style={{ background: 'var(--ios-green)' }}>
                      <Coins size={18} color="#FFFFFF" />
                    </div>
                  }
                  label="Operating Currency"
                  description="Rate per ton & settlements"
                  value={settings.currency || 'PKR (Rs.)'}
                  onChange={async (val) => {
                    handleChange('currency', val);
                    const updated = { ...settings, currency: val };
                    await saveSettings(updated);
                    playPopSound();
                    showToast(`Currency set to ${val}`);
                  }}
                  options={CURRENCY_SELECT_OPTIONS}
                  title="Select Operating Currency"
                />
                <div className="ios-separator with-glyph" />
              </div>

              {/* Number Format Style (Custom iOS Dropdown) */}
              <div style={{ position: 'relative' }}>
                <IOSSelect
                  glyphBadge={
                    <div className="ios-glyph-badge" style={{ background: 'var(--ios-teal)' }}>
                      <Layers size={18} color="#FFFFFF" />
                    </div>
                  }
                  label="Denomination Style"
                  description="Comma formatting on totals"
                  value={settings.numberFormat || 'million'}
                  onChange={async (val) => {
                    handleChange('numberFormat', val);
                    const updated = { ...settings, numberFormat: val };
                    await saveSettings(updated);
                    playPopSound();
                    showToast(`Formatted in ${val === 'lakh' ? 'Lakhs (10,00,000)' : 'Millions (1,000,000)'}`);
                  }}
                  options={NUMBER_FORMAT_OPTIONS}
                  title="Number Denomination Style"
                />
                <div className="ios-separator with-glyph" />
              </div>

              {/* Default Tax Calculation Configuration Cell */}
              <div
                className="ios-cell"
                onClick={() => {
                  playPopSound();
                  setShowTaxFormulaModal(true);
                }}
                style={{ cursor: 'pointer', padding: '13px 16px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <div className="ios-glyph-badge" style={{ background: 'var(--ios-orange)' }}>
                    <FileText size={18} color="#FFFFFF" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ios-cell-label" style={{ fontSize: 16 }}>Default Tax Calculation</div>
                    <div className="ios-cell-desc" style={{ marginTop: 2, fontSize: 13, color: 'var(--label-secondary)' }}>
                      {settings.defaultTaxMethod === 'manual'
                        ? 'Manual Tax Entry'
                        : `Formula: (Rate + ${settings.taxFormulaSalesPercent ?? 18}%) × ${settings.taxFormulaIncomePercent ?? 5}%`}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--label-tertiary)' }}>
                  <span style={{ fontSize: 13, color: 'var(--ios-blue)', fontWeight: 500 }}>
                    {settings.defaultTaxMethod === 'manual' ? 'Manual' : 'Formula'}
                  </span>
                  <ChevronRight size={18} />
                </div>
              </div>

              {/* Issue 45: One-time migration notice for existing installs */}
              {showManualTaxNotice && (
                <div
                  style={{
                    margin: '0 0 0 0',
                    padding: '12px 16px',
                    background: 'rgba(255, 159, 10, 0.12)',
                    borderTop: '0.5px solid rgba(255, 159, 10, 0.3)',
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                  }}
                >
                  <Lightbulb size={18} style={{ color: 'var(--ios-orange)', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-primary)', marginBottom: 4 }}>
                      New Default: Manual Tax
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--label-secondary)', lineHeight: 1.5 }}>
                      New installs now default to Manual Tax entry. Your app still uses the Formula. Tap below to switch, or dismiss to keep Formula.
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button
                        style={{
                          background: 'var(--ios-orange)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          padding: '6px 14px',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        onClick={async () => {
                          const updated = { ...settings, defaultTaxMethod: 'manual' as const };
                          setSettings(updated);
                          await saveSettings(updated);
                          localStorage.setItem('migrations.manualTaxNotice_v1', '1');
                          setShowManualTaxNotice(false);
                          showToast('Default tax changed to Manual');
                        }}
                      >
                        Switch to Manual
                      </button>
                      <button
                        style={{
                          background: 'var(--fill-secondary)',
                          color: 'var(--label-secondary)',
                          border: 'none',
                          borderRadius: 8,
                          padding: '6px 14px',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          localStorage.setItem('migrations.manualTaxNotice_v1', '1');
                          setShowManualTaxNotice(false);
                        }}
                      >
                        Keep Formula
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── ACCORDION 7: Data & Storage Management ── */}
      <div className="ios-group" style={{ marginBottom: 14 }}>
        <div className="ios-card-grouped" style={{ overflow: 'hidden' }}>
          <div
            className="ios-cell"
            onClick={() => toggleSection('backup')}
            style={{
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '13px 16px',
              minHeight: 54,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div className="ios-glyph-badge" style={{ background: 'var(--ios-teal)', flexShrink: 0 }}>
                <Download size={18} color="#FFFFFF" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', letterSpacing: '-0.2px' }}>
                  Data & Backup
                </span>
                {!openSections['backup'] && (
                  <span style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
                    {stats.dispatches} Trucks · {stats.mines} Mines · {stats.lots} Stock · Backup: {formatBackupShort(lastBackupDate)}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <ChevronDown
                style={{
                  width: 18,
                  height: 18,
                  color: 'var(--label-tertiary)',
                  transform: openSections['backup'] ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                strokeWidth={2.4}
              />
            </div>
            {openSections['backup'] && <div className="ios-separator with-glyph" />}
          </div>

          {openSections['backup'] && (
            <div>
              {/* Record Metrics Counter */}
              <div style={{ padding: '14px 16px', background: 'var(--bg-card)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)', letterSpacing: '-0.1px' }}>
                    OFFLINE DATABASE RECORDS
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--label-tertiary)' }}>
                    Total: {stats.dispatches + stats.parties + stats.payments + stats.pos + stats.expenses + stats.mines + stats.lots}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  <div style={{ background: 'var(--fill-tertiary)', padding: '10px 8px', borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }}>{stats.dispatches}</div>
                    <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Dispatches</div>
                  </div>
                  <div style={{ background: 'var(--fill-tertiary)', padding: '10px 8px', borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }}>{stats.parties}</div>
                    <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Parties</div>
                  </div>
                  <div style={{ background: 'var(--fill-tertiary)', padding: '10px 8px', borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }}>{stats.mines}</div>
                    <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Mines</div>
                  </div>
                  <div style={{ background: 'var(--fill-tertiary)', padding: '10px 8px', borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }}>{stats.lots}</div>
                    <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Stock Entries</div>
                  </div>
                  <div style={{ background: 'var(--fill-tertiary)', padding: '10px 8px', borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }}>{stats.payments}</div>
                    <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Payments</div>
                  </div>
                  <div style={{ background: 'var(--fill-tertiary)', padding: '10px 8px', borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }}>{stats.pos}</div>
                    <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Orders</div>
                  </div>
                  <div style={{ background: 'var(--fill-tertiary)', padding: '10px 8px', borderRadius: 10, textAlign: 'center', gridColumn: 'span 2' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }}>{stats.expenses}</div>
                    <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Expenses</div>
                  </div>
                </div>

                {/* Last Created Backup Info Box */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 10,
                    padding: '9px 12px',
                    background: 'var(--fill-quaternary)',
                    borderRadius: 10,
                    border: '0.5px solid var(--separator-opaque, rgba(255,255,255,0.06))',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--label-secondary)', fontSize: 12 }}>
                    <Calendar size={13} style={{ flexShrink: 0 }} />
                    <span>Last Created Backup</span>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: lastBackupDate ? 'var(--label-primary)' : 'var(--label-tertiary)',
                    }}
                  >
                    {formatBackupDateTime(lastBackupDate)}
                  </span>
                </div>

                <div className="ios-separator with-glyph" style={{ marginTop: 14 }} />
              </div>

              {/* Export Full Backup */}
              <div className="ios-cell" onClick={handleTriggerExport} style={{ cursor: 'pointer' }}>
                <div className="ios-glyph-badge" style={{ background: 'var(--ios-blue)' }}>
                  <Download size={18} color="#FFFFFF" />
                </div>
                <div style={{ flex: 1 }}>
                  <span className="ios-cell-label">Export Full Backup (JSON)</span>
                  <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
                    {lastBackupDate ? `Last created: ${formatBackupDateTime(lastBackupDate)}` : 'Download offline JSON database backup (credentials excluded)'}
                  </div>
                </div>
                <span style={{ fontSize: 14, color: 'var(--ios-blue)', fontWeight: 600 }}>Export</span>
                <div className="ios-separator with-glyph" />
              </div>

              {/* Import Full Backup */}
              <div className="ios-cell" onClick={handleTriggerImport} style={{ cursor: 'pointer' }}>
                <div className="ios-glyph-badge" style={{ background: 'var(--ios-purple)' }}>
                  <Upload size={18} color="#FFFFFF" />
                </div>
                <div style={{ flex: 1 }}>
                  <span className="ios-cell-label">Import & Restore Backup</span>
                  <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>Restore from JSON database file</div>
                </div>
                <span style={{ fontSize: 14, color: 'var(--ios-blue)', fontWeight: 600 }}>Import</span>
                <div className="ios-separator with-glyph" />
              </div>

              {/* Undo Last Restore (Issue 24) */}
              {snapshotMeta && (
                <div
                  className="ios-cell"
                  onClick={() => {
                    playPopSound();
                    setShowRollbackConfirm(true);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="ios-glyph-badge" style={{ background: 'var(--ios-orange)' }}>
                    <RotateCcw size={18} color="#FFFFFF" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="ios-cell-label" style={{ color: 'var(--label-primary)' }}>
                      Undo Last Restore
                    </span>
                    <div style={{ fontSize: 12, color: 'var(--label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Saved {snapshotMeta.dateStr} · {snapshotMeta.dispatchCount} trucks, {snapshotMeta.partyCount} parties
                    </div>
                  </div>
                  <span style={{ fontSize: 14, color: 'var(--ios-orange)', fontWeight: 600 }}>Undo</span>
                  <div className="ios-separator with-glyph" />
                </div>
              )}

              {/* Recoverable snapshots from multi-device conflict resolution */}
              <div
                className="ios-cell"
                onClick={handleExportConflictArchive}
                style={{ cursor: conflictArchiveCount > 0 && !isExportingConflicts ? 'pointer' : 'default', minHeight: 58 }}
              >
                <div className="ios-glyph-badge" style={{ background: 'var(--ios-indigo, #5856D6)' }}>
                  <History size={18} color="#FFFFFF" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="ios-cell-label">Conflict Recovery Archive</span>
                  <div style={{ fontSize: 12, color: 'var(--label-secondary)', lineHeight: 1.35 }}>
                    {conflictArchiveCount > 0
                      ? `${conflictArchiveCount} conflict${conflictArchiveCount === 1 ? '' : 's'} with winning and losing versions`
                      : 'No multi-device conflict snapshots saved'}
                  </div>
                </div>
                {conflictArchiveCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      disabled={isExportingConflicts}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleExportConflictArchive();
                      }}
                      style={{
                        minHeight: 44,
                        padding: '0 10px',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--ios-blue)',
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: isExportingConflicts ? 'default' : 'pointer',
                      }}
                    >
                      {isExportingConflicts ? 'Exporting…' : 'Export'}
                    </button>
                    <button
                      type="button"
                      aria-label="Clear conflict recovery archive"
                      onClick={(event) => {
                        event.stopPropagation();
                        playPopSound();
                        setShowClearConflictArchiveConfirm(true);
                      }}
                      style={{
                        width: 44,
                        height: 44,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--ios-red)',
                        display: 'grid',
                        placeItems: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                )}
                <div className="ios-separator with-glyph" />
              </div>

              {/* Seed Demo / Test Data - Development Only */}
              {import.meta.env.DEV && (
                <div
                  className="ios-cell"
                  onClick={() => {
                    playPopSound();
                    setShowSeedConfirm(true);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="ios-glyph-badge" style={{ background: '#8B5CF6' }}>
                    <Database size={18} color="#FFFFFF" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span className="ios-cell-label" style={{ color: 'var(--label-primary)' }}>
                      Populate Demo / Test Data
                    </span>
                    <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>Seed buyers, suppliers, inventory & dispatches (devSeed.ts)</div>
                  </div>
                  <ChevronRight size={18} color="var(--label-tertiary)" />
                  <div className="ios-separator with-glyph" />
                </div>
              )}

              {/* Erase All Data */}
              <div
                className="ios-cell"
                onClick={() => {
                  playPopSound();
                  if (googleUser) {
                    setShowSignedInClearModal(true);
                  } else {
                    setShowClearConfirm(true);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <div className="ios-glyph-badge" style={{ background: 'var(--ios-red)' }}>
                  <Trash2 size={18} color="#FFFFFF" />
                </div>
                <div style={{ flex: 1 }}>
                  <span className="ios-cell-label" style={{ color: 'var(--ios-red)' }}>
                    Erase All Database Records
                  </span>
                  <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>Clear local storage & start fresh</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* App Version & Release Notes Preview */}
        <div style={{ marginTop: 24, textAlign: 'center', paddingBottom: 28 }}>
          <div style={{ fontSize: 13, color: 'var(--label-secondary)', fontWeight: 500, letterSpacing: '-0.1px' }}>
            Factory Ledger v{CURRENT_WHATS_NEW_VERSION}
          </div>
          <button
            type="button"
            onClick={() => {
              playPopSound();
              window.dispatchEvent(new CustomEvent('open-whats-new'));
            }}
            style={{
              marginTop: 6,
              background: 'none',
              border: 'none',
              color: 'var(--ios-blue)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 12px',
              borderRadius: 8,
            }}
          >
            <Sparkles size={14} strokeWidth={2.2} />
            <span>Preview What&apos;s New</span>
          </button>
        </div>
      </div>

      {/* ── Confirmation Modals ── */}
      <IOSConfirmModal
        isOpen={showRollbackConfirm}
        title="Undo Last Restore?"
        message={
          snapshotMeta
            ? `Replace current data with the data from before your last restore (saved ${snapshotMeta.dateStr}: ${snapshotMeta.dispatchCount} dispatches, ${snapshotMeta.partyCount} parties)? Your current data will be saved so you can undo this too.`
            : 'Replace current data with the data from before your last restore? Your current data will be saved so you can undo this too.'
        }
        confirmText={isRollingBack ? 'Restoring...' : 'Roll Back Data'}
        cancelText="Cancel"
        destructive={false}
        countdownSeconds={0}
        icon="warning"
        onConfirm={handleConfirmRollback}
        onCancel={() => setShowRollbackConfirm(false)}
      />

      <IOSConfirmModal
        isOpen={showRestoreCloudConfirm}
        title="Restore from Firebase Cloud?"
        message="Restore ledgers and parties from Firebase Cloud? This will merge and download your cloud records to this device."
        confirmText={isRestoringFromCloud ? 'Restoring...' : 'Restore Data'}
        cancelText="Cancel"
        destructive={false}
        countdownSeconds={0}
        icon="none"
        onConfirm={executeCloudRestore}
        onCancel={() => setShowRestoreCloudConfirm(false)}
      />

      <IOSConfirmModal
        isOpen={showClearConfirm}
        title="Clear All Data?"
        message="Are you sure you want to clear ALL dispatches, parties, payments, and POs? This action cannot be undone."
        confirmText="Clear All Data"
        cancelText="Cancel"
        destructive
        countdownSeconds={2}
        icon="warning"
        onConfirm={handleConfirmClear}
        onCancel={() => setShowClearConfirm(false)}
      />

      {import.meta.env.DEV && (
        <IOSConfirmModal
          isOpen={showSeedConfirm}
          title="Populate Demo / Test Data?"
          message="This will overwrite local database records with realistic sample buyers, suppliers, inventory lots, dispatches, and payments (devSeed.ts)."
          confirmText={isSeeding ? 'Populating...' : 'Populate Data'}
          cancelText="Cancel"
          destructive={false}
          countdownSeconds={0}
          icon="none"
          onConfirm={async () => {
            setIsSeeding(true);
            try {
              if (typeof (window as any).seedTestData === 'function') {
                await (window as any).seedTestData({ reload: true, clearBeforeSeed: true });
              }
            } finally {
              setIsSeeding(false);
              setShowSeedConfirm(false);
            }
          }}
          onCancel={() => setShowSeedConfirm(false)}
        />
      )}

      <IOSConfirmModal
        isOpen={showClearConflictArchiveConfirm}
        title="Clear Conflict Archive?"
        message="Remove the saved winning and losing versions from past multi-device conflicts? Current ledger records will not be changed, but those recovery snapshots cannot be restored afterward."
        confirmText="Clear Archive"
        cancelText="Cancel"
        destructive
        countdownSeconds={1}
        icon="trash"
        onConfirm={handleClearConflictArchive}
        onCancel={() => setShowClearConflictArchiveConfirm(false)}
      />

      <IOSConfirmModal
        isOpen={showRemoveLogoConfirm}
        title="Remove Company Logo?"
        message="Are you sure you want to remove your company logo? It will no longer appear on exported bills and PDF receipts."
        confirmText="Remove"
        cancelText="Cancel"
        destructive
        countdownSeconds={0}
        icon="trash"
        onConfirm={handleConfirmRemoveLogo}
        onCancel={() => setShowRemoveLogoConfirm(false)}
      />

      <IOSConfirmModal
        isOpen={showRemoveSignatureConfirm}
        title="Remove Authorized Signature?"
        message="Are you sure you want to remove your authorized signature image? Invoices will no longer display a signature."
        confirmText="Remove"
        cancelText="Cancel"
        destructive
        countdownSeconds={0}
        icon="trash"
        onConfirm={handleConfirmRemoveSignature}
        onCancel={() => setShowRemoveSignatureConfirm(false)}
      />

      <IOSConfirmModal
        isOpen={showDisableLockConfirm}
        title="Turn Off App Lock?"
        message="Are you sure you want to disable passcode protection? Anyone who opens the app will be able to access the business ledgers."
        confirmText="Turn Off"
        cancelText="Cancel"
        destructive
        countdownSeconds={0}
        icon="warning"
        onConfirm={handleConfirmDisableLock}
        onCancel={() => setShowDisableLockConfirm(false)}
      />

      <IOSConfirmModal
        isOpen={Boolean(restoreConfirmationScenario)}
        title="Restore Ledger on This Browser?"
        message={
          restoreConfirmationScenario
            ? `Google account ${restoreConfirmationScenario.user.email} has ${restoreConfirmationScenario.cloudCount} cloud records. Download this ledger to this device?`
            : 'Download this Google account ledger to this device?'
        }
        confirmText="Restore Ledger"
        cancelText="Keep Offline"
        destructive={false}
        countdownSeconds={0}
        icon="none"
        onConfirm={async () => {
          if (!restoreConfirmationScenario) return;
          const { user, cloudData } = restoreConfirmationScenario;
          if (cloudData) {
            const restoreResult = await restoreBackup(cloudData, { silent: false });
            if (!restoreResult.success) {
              showToast(`Cloud restore stopped: ${restoreResult.message}`);
              return;
            }
          }
          setRestoreConfirmed(user.uid, true);
          setLedgerOwner(user.uid, user.email);
          setRestoreConfirmationScenario(null);
          playSuccessSound();
          triggerConfetti();
          showToast(`Restored ${restoreConfirmationScenario.cloudCount} cloud records.`);
          loadAllData();
        }}
        onCancel={() => {
          if (restoreConfirmationScenario) {
            setRestoreConfirmed(restoreConfirmationScenario.user.uid, false);
          }
          setRestoreConfirmationScenario(null);
          showToast('Cloud restore skipped. Ledger kept offline.');
        }}
      />

      <IOSTotpMfaModal
        isOpen={Boolean(totpSignInChallenge)}
        onVerify={handleCompleteTotpSignIn}
        onCancel={() => {
          cancelTotpSignIn();
          setTotpSignInChallenge(null);
          showToast('Authenticator sign-in cancelled. Your local ledger is unchanged.');
        }}
      />

      {/* ── Set / Change Passcode PIN Modal ── */}
      <IOSSetPasscodeModal
        isOpen={showPasscodeModal}
        mode={isChangingPasscode ? 'change' : 'create'}
        onSuccess={handlePasscodeSuccess}
        onCancel={() => setShowPasscodeModal(false)}
      />

      {/* ── Real-World Account & Sync Modals ── */}
      {switchScenario && (
        <AccountSwitchModal
          isOpen={Boolean(switchScenario)}
          previousEmail={switchScenario.previousEmail || 'previous account'}
          newEmail={switchScenario.newEmail || 'new account'}
          localCount={switchScenario.localCount || 0}
          cloudCount={switchScenario.cloudCount || 0}
          onSwitchToNewAccount={async () => {
            const res = await resolveLoginDecision('use_cloud', switchScenario);
            setSwitchScenario(null);
            playSuccessSound();
            triggerConfetti();
            showToast(res.message);
            loadAllData();
          }}
          onMergeIntoNewAccount={async () => {
            const res = await resolveLoginDecision('merge', switchScenario);
            setSwitchScenario(null);
            playSuccessSound();
            triggerConfetti();
            showToast(res.message);
            loadAllData();
          }}
          onCancel={async () => {
            await resolveLoginDecision('cancel', switchScenario);
            setSwitchScenario(null);
            showToast('Sign-in cancelled. Local records kept intact.');
          }}
        />
      )}

      {conflictScenario && (
        <AnonymousConflictModal
          isOpen={Boolean(conflictScenario)}
          email={conflictScenario.newEmail || 'Google Account'}
          localCount={conflictScenario.localCount || 0}
          cloudCount={conflictScenario.cloudCount || 0}
          onMerge={async () => {
            const res = await resolveLoginDecision('merge', conflictScenario);
            setConflictScenario(null);
            playSuccessSound();
            triggerConfetti();
            showToast(res.message);
            loadAllData();
          }}
          onUseCloud={async () => {
            const res = await resolveLoginDecision('use_cloud', conflictScenario);
            setConflictScenario(null);
            playSuccessSound();
            triggerConfetti();
            showToast(res.message);
            loadAllData();
          }}
          onCancel={async () => {
            await resolveLoginDecision('cancel', conflictScenario);
            setConflictScenario(null);
            showToast('Sign-in cancelled.');
          }}
        />
      )}

      {isSignOutSheetOpen && googleUser && (
        <SignOutActionSheet
          isOpen={isSignOutSheetOpen}
          email={googleUser.email}
          onKeepData={() => handleConfirmSignOut('keep_data')}
          onClearData={() => handleConfirmSignOut('clear_data')}
          onCancel={() => setIsSignOutSheetOpen(false)}
        />
      )}

      {showSignedInClearModal && googleUser && (
        <ClearDataOptionsSheet
          isOpen={showSignedInClearModal}
          email={googleUser.email || ''}
          onClearDeviceOnly={handleClearDeviceOnly}
          onClearCloudAndDevice={handleClearCloudAndDevice}
          onCancel={() => setShowSignedInClearModal(false)}
        />
      )}

      {/* iOS Tax Formula Configuration Modal */}
      <IOSTaxFormulaModal
        isOpen={showTaxFormulaModal}
        initialMethod={settings.defaultTaxMethod || 'formula_18_5'}
        initialSalesPercent={settings.taxFormulaSalesPercent ?? 18}
        initialIncomePercent={settings.taxFormulaIncomePercent ?? 5}
        onSave={async (method, salesPct, incomePct) => {
          const updated: AppSettings = {
            ...settings,
            defaultTaxMethod: method,
            taxFormulaSalesPercent: salesPct,
            taxFormulaIncomePercent: incomePct,
          };
          setSettings(updated);
          await saveSettings(updated);
          setShowTaxFormulaModal(false);
          showToast('Tax formula configuration updated');
        }}
        onCancel={() => setShowTaxFormulaModal(false)}
      />

      {/* ── Verify Passcode before Disabling Lock Modal ── */}
      <IOSVerifyPasscodeModal
        isOpen={showVerifyPinForDisable}
        title="Verify Passcode to Turn Off Lock"
        subtitle="Enter your current passcode to disable App Lock"
        onSuccess={handlePasscodeVerifiedForDisable}
        onCancel={() => setShowVerifyPinForDisable(false)}
      />

      {/* ── Verify Passcode before Export Modal ── */}
      <IOSVerifyPasscodeModal
        isOpen={showVerifyPinForExport}
        title="Verify Passcode to Export"
        subtitle="Enter your passcode to download confidential ledger backup"
        onSuccess={() => {
          setShowVerifyPinForExport(false);
          executeExport();
        }}
        onCancel={() => setShowVerifyPinForExport(false)}
      />

      <IOSVerifyPasscodeModal
        isOpen={showVerifyPinForConflictExport}
        title="Verify Passcode to Export"
        subtitle="Enter your passcode to download confidential conflict snapshots"
        onSuccess={() => {
          setShowVerifyPinForConflictExport(false);
          executeConflictArchiveExport();
        }}
        onCancel={() => setShowVerifyPinForConflictExport(false)}
      />

      {/* ── Verify Passcode before Import Modal ── */}
      <IOSVerifyPasscodeModal
        isOpen={showVerifyPinForImport}
        title="Verify Passcode to Import"
        subtitle="Enter your passcode to authorize database import"
        onSuccess={() => {
          setShowVerifyPinForImport(false);
          fileInputRef.current?.click();
        }}
        onCancel={() => setShowVerifyPinForImport(false)}
      />

      {/* ── Import Decision & Stats Modal ── */}
      <IOSImportConfirmModal
        isOpen={showImportConfirmModal}
        fileName={pendingImportFile?.name || 'backup.json'}
        backupData={pendingImportFile?.data || null}
        onConfirm={handleConfirmImport}
        onCancel={() => {
          setShowImportConfirmModal(false);
          setPendingImportFile(null);
        }}
      />
    </div>
  );
}

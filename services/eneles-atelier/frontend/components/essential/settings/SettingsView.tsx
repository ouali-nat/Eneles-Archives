"use client";

import { useState, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { useMotion } from "@/hooks/useMotion";
import { Segmented } from "@/components/ui/segmented";
import { Settings2, Bell, Shield, Smartphone, CheckCircle2, Circle, Trash2, Globe, Monitor, Sun, Moon, Copy, Key, Plus, Edit, Trash, ShieldCheck, ShieldOff, Eye, EyeOff } from "@/components/icons";
import { QRCodeCanvas } from "qrcode.react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { settingsAPI, apiKeysAPI } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Container } from "@/components/ui/container";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader, SectionHeading } from "@/components/essential/layout/PageHeader"
import { DeleteAccount } from "@/components/essential/dashboard/DeleteAccount"
import { countryName } from "@/components/admin/format"
import { DataTable, asTime, type Column } from "@/components/ui/data-table"
import { RelativeTime } from "@/components/ui/time"

const notificationsFormSchema = z.object({
  notifyLowCredits: z.boolean(),
  emailNotifications: z.boolean(),
  marketingEmails: z.boolean(),
  securityAlerts: z.boolean(),
});

type NotificationsFormValues = z.infer<typeof notificationsFormSchema>;

const getDeviceIcon = (deviceType: string) => {
  switch (deviceType.toLowerCase()) {
    case "mobile":
      return Smartphone;
    case "tablet":
      return Smartphone;
    case "desktop":
      return Monitor;
    default:
      return Globe;
  }
};

const noopSubscribe = () => () => {};

/**
 * The Settings page: security (two-factor sign-in, sessions, API keys), appearance, notifications, and deleting the account. The site shows all of it; the desktop app puts its own sections around it (compiling, spelling, the account it is signed in with) and leaves out what needs an account until one is signed in.
 */
export function SettingsView({
  description = "Security, sessions, API keys, and editor preferences.",
  leading,
  trailing,
  account = true,
}: {
  description?: string;
  /** Sections before the rest. */
  leading?: ReactNode;
  /** Sections after Notifications, before deleting the account. */
  trailing?: ReactNode;
  /** Whether to show what belongs to a signed-in account: security, notifications, and deleting it. */
  account?: boolean;
} = {}) {
  const { theme, setTheme } = useTheme();
  const { preference: motionPreference, setPreference: setMotionPreference } = useMotion();
  const { user, isAuthenticated } = useAuth();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);

  // 2FA dialog state
  // 2FA dialog state
  const [show2FADialog, setShow2FADialog] = useState(false);
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorUrl, setTwoFactorUrl] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [enabling2FA, setEnabling2FA] = useState(false);
  const [disabling2FA, setDisabling2FA] = useState(false);
  const [showDisable2FAConfirm, setShowDisable2FAConfirm] = useState(false);
  const [disable2FACode, setDisable2FACode] = useState("");

  // API Keys state
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [loadingApiKeys, setLoadingApiKeys] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<number | null>(null);
  const [editingKeyName, setEditingKeyName] = useState("");
  const [deletingKeyId, setDeletingKeyId] = useState<number | null>(null);
  // Avoid hydration mismatch: the saved theme is only known in the browser
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // Dark mode toggle (boolean)

  // Notifications form
  const notificationsForm = useForm<NotificationsFormValues>({
    resolver: zodResolver(notificationsFormSchema),
    defaultValues: {
      notifyLowCredits: true,
      emailNotifications: true,
      marketingEmails: false,
      securityAlerts: true,
    },
  });

  // Load settings from API
  useEffect(() => {
    if (isAuthenticated) {
      // Load notification settings
      settingsAPI.getNotificationSettings().then((data) => {
        notificationsForm.reset({
          notifyLowCredits: data.notifyLowCredits,
          emailNotifications: data.emailNotifications,
          marketingEmails: data.marketingEmails,
          securityAlerts: data.securityAlerts,
        });
      });

      // Load sessions
      settingsAPI.getSessions().then((res) => {
        setSessions(res.data);
        setLoadingSessions(false);
      });

      // Load 2FA status
      settingsAPI.getTwoFactorStatus().then((data) => {
        setTwoFactorEnabled(data.enabled);
      });

      // Load API keys
      apiKeysAPI
        .getApiKeys()
        .then((res) => {
          setApiKeys(res.data);
          setLoadingApiKeys(false);
        })
        .catch(() => {
          setLoadingApiKeys(false);
        });
    }
  }, [isAuthenticated, notificationsForm]);

  // Color mode: applies at once, then saves to the account.
  async function handleThemeChange(newTheme: "system" | "light" | "dark") {
    setTheme(newTheme);
    if (isAuthenticated) {
      try {
        await settingsAPI.updateAppearanceSettings({ theme: newTheme });
      } catch {
        // Silently fail: theme is already applied locally
      }
    }
  }

  async function onNotificationsSubmit(data: NotificationsFormValues) {
    if (!isAuthenticated) return;
    try {
      await settingsAPI.updateNotificationSettings(data);
      toast.success("Notification settings saved");
    } catch (error) {
      toast.error("Failed to save settings");
    }
  }

  // 2FA handlers
  async function handleEnableTwoFactor() {
    if (!isAuthenticated) return;
    try {
      const data = await settingsAPI.setupTwoFactor();
      setTwoFactorSecret(data.secret);
      setTwoFactorUrl(data.otpauthUrl);
      setOtpCode("");
      setShowSecret(false);
      setShow2FADialog(true);
    } catch (error) {
      toast.error("Failed to initialize 2FA setup");
    }
  }

  async function confirmEnableTwoFactor() {
    if (!isAuthenticated) return;
    if (otpCode.length !== 6) {
      toast.error("Please enter the 6-digit code");
      return;
    }

    setEnabling2FA(true);
    try {
      await settingsAPI.enableTwoFactor(twoFactorSecret, otpCode);
      setTwoFactorEnabled(true);
      setShow2FADialog(false);
      setTwoFactorSecret("");
      setTwoFactorUrl("");
      setOtpCode("");
      toast.success("Two-factor authentication enabled");
    } catch (error) {
      toast.error("Invalid code. Please try again.");
    } finally {
      setEnabling2FA(false);
    }
  }

  async function handleDisableTwoFactor() {
    if (!isAuthenticated) return;
    if (disable2FACode.length !== 6) {
      toast.error("Please enter the 6-digit code from your authenticator app");
      return;
    }
    setDisabling2FA(true);
    try {
      await settingsAPI.disableTwoFactor(disable2FACode);
      setTwoFactorEnabled(false);
      setShowDisable2FAConfirm(false);
      setDisable2FACode("");
      toast.success("Two-factor authentication disabled");
    } catch (error) {
      toast.error("Invalid code. Please try again.");
    } finally {
      setDisabling2FA(false);
    }
  }

  async function handleDisconnectDevice(sessionId: number) {
    if (!isAuthenticated) return;
    try {
      await settingsAPI.deleteSession(sessionId);
      setSessions(sessions.filter((s) => s.id !== sessionId));
      toast.success("Device disconnected successfully");
    } catch (error) {
      toast.error("Failed to disconnect device");
    }
  }

  // API Key handlers
  async function handleCreateApiKey() {
    if (!isAuthenticated || !newApiKeyName.trim()) {
      toast.error("Please enter a name for the API key");
      return;
    }
    try {
      const result = await apiKeysAPI.createApiKey(newApiKeyName.trim());
      setCreatedApiKey(result.apiKey);
      setShowCreateDialog(false);
      setShowApiKeyDialog(true);
      setNewApiKeyName("");
      // Refresh API keys list
      const res = await apiKeysAPI.getApiKeys();
      setApiKeys(res.data);
      toast.success("API key created successfully");
    } catch (error) {
      toast.error("Failed to create API key");
    }
  }

  async function handleUpdateApiKeyName() {
    if (!isAuthenticated || !editingKeyId || !editingKeyName.trim()) {
      toast.error("Please enter a valid name");
      return;
    }
    try {
      await apiKeysAPI.updateApiKeyName(editingKeyId,
        editingKeyName.trim(),
      );
      setApiKeys(
        apiKeys.map((k) =>
          k.id === editingKeyId ? { ...k, name: editingKeyName.trim() } : k,
        ),
      );
      setEditingKeyId(null);
      setEditingKeyName("");
      toast.success("API key name updated");
    } catch (error) {
      toast.error("Failed to update API key name");
    }
  }

  async function handleDeleteApiKey(keyId: number) {
    if (!isAuthenticated) return;
    try {
      await apiKeysAPI.deleteApiKey(keyId);
      setApiKeys(apiKeys.filter((k) => k.id !== keyId));
      setDeletingKeyId(null);
      toast.success("API key deleted successfully");
    } catch (error) {
      toast.error("Failed to delete API key");
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }

  return (
    <Container>
      <div className="space-y-6">
        <div className="space-y-6">
          {/* Header */}
          <PageHeader title="Settings" description={description} />

          <div className="space-y-8">
            {leading}

            {/* Security Section */}
            {account && <div className="space-y-4">
              <SectionHeading title="Security" />

              {/* Two-Factor Authentication */}
              <div className="flex items-center justify-between rounded-lg border p-4 bg-card">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                    <Shield className="h-5 w-5 text-foreground" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">Two-factor authentication</p>
                      {twoFactorEnabled ? (
                        <Badge variant="default" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <Circle className="h-3 w-3" />
                          Disabled
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Add an extra layer of security with authenticator apps
                    </p>
                  </div>
                </div>
                {twoFactorEnabled ? (
                  <Button
                    variant="outline"
                    onClick={() => setShowDisable2FAConfirm(true)}
                  >
                    <ShieldOff className="h-4 w-4 me-2" />
                    Disable
                  </Button>
                ) : (
                  <Button variant="default" onClick={handleEnableTwoFactor}>
                    <ShieldCheck className="h-4 w-4 me-2" />
                    Enable
                  </Button>
                )}
              </div>

              {/* Connected Devices */}
              <Card>
                <CardHeader>
                  <CardTitle>Active sessions</CardTitle>
                  <CardDescription>
                    Manage devices where you&apos;re currently signed in
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(
                    <DataTable
                      label="Active sessions"
                      loading={loadingSessions && 2}
                      empty="No other devices are signed in."
                      framed={false}
                      className="rounded-[var(--radius-card)] border border-line"
                      rows={sessions}
                      rowKey={(session) => session.id}
                      defaultSort={{ column: "lastActive", direction: "desc" }}
                      columns={[
                        {
                          id: "device",
                          header: "Device",
                          sortValue: (session) => `${session.current ? 0 : 1} ${session.deviceType}`,
                          cell: (session) => {
                            const DeviceIcon = getDeviceIcon(session.deviceType);
                            return (
                              <div className="flex items-center gap-3">
                                <div className="flex size-8 items-center justify-center rounded-full bg-surface">
                                  <DeviceIcon className="size-4" />
                                </div>
                                <span className="font-medium capitalize">{session.deviceType}</span>
                                {session.current === true && <Badge variant="outline">Current</Badge>}
                              </div>
                            );
                          },
                        },
                        { id: "browser", header: "Browser", sortValue: (session) => session.browser, cell: (session) => <span className="text-muted-foreground">{session.browser}</span> },
                        { id: "os", header: "System", sortValue: (session) => session.os, cell: (session) => <span className="text-muted-foreground">{session.os}</span> },
                        { id: "location", header: "Country", sortValue: (session) => countryName(session.location), cell: (session) => <span className="text-muted-foreground">{countryName(session.location)}</span> },
                        { id: "lastActive", header: "Last active", sortValue: (session) => asTime(session.lastActive), cell: (session) => <RelativeTime value={session.lastActive} className="text-muted-foreground" /> },
                        {
                          id: "actions",
                          header: "Sign out",
                          hideHeader: true,
                          sortable: false,
                          align: "end",
                          cell: (session) =>
                            session.current !== true && (
                              <Button variant="ghost" size="icon-sm" aria-label="Sign out this device" onClick={() => handleDisconnectDevice(session.id)}>
                                <Trash2 className="size-4" />
                              </Button>
                            ),
                        },
                      ] satisfies Column<any>[]}
                    />
                  )}
                </CardContent>
              </Card>

              {/* API Keys */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>API keys</CardTitle>
                      <CardDescription>
                        Manage API keys for programmatic access
                      </CardDescription>
                    </div>
                    <Dialog
                      open={showCreateDialog}
                      onOpenChange={setShowCreateDialog}
                    >
                      <DialogTrigger asChild>
                        <Button>
                          <Plus className="h-4 w-4 me-2" />
                          Create API key
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Create an API key</DialogTitle>
                          <DialogDescription>
                            Give your API key a descriptive name to help you
                            remember its purpose.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="keyName">Name</Label>
                            <Input
                              id="keyName"
                              placeholder="e.g., Production Server"
                              value={newApiKeyName}
                              onChange={(e) => setNewApiKeyName(e.target.value)}
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setShowCreateDialog(false)}
                          >
                            Cancel
                          </Button>
                          <Button onClick={handleCreateApiKey}>
                            Create key
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent>
                  {(
                    <DataTable
                      label="API keys"
                      loading={loadingApiKeys && 2}
                      empty="No API keys yet. Create one to use Eneles from your own scripts."
                      framed={false}
                      className="rounded-[var(--radius-card)] border border-line"
                      rows={apiKeys}
                      rowKey={(key) => key.id}
                      defaultSort={{ column: "created", direction: "desc" }}
                      columns={[
                        {
                          id: "name",
                          header: "Name",
                          sortValue: (key) => key.name,
                          cell: (key) =>
                            editingKeyId === key.id ? (
                              <div className="flex items-center gap-2">
                                <Input value={editingKeyName} onChange={(e) => setEditingKeyName(e.target.value)} className="max-w-xs" aria-label="Key name" />
                                <Button onClick={handleUpdateApiKeyName}>Save</Button>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setEditingKeyId(null);
                                    setEditingKeyName("");
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <Key className="size-4 text-muted-foreground" />
                                <span className="font-medium">{key.name}</span>
                              </div>
                            ),
                        },
                        { id: "key", header: "Key", sortValue: (key) => key.keyPrefix, cell: (key) => <code className="rounded-[var(--radius-inset)] bg-surface px-2 py-1 font-mono type-small">{key.keyPrefix}…</code> },
                        { id: "lastUsed", header: "Last used", sortValue: (key) => asTime(key.lastUsedAt), cell: (key) => <RelativeTime value={key.lastUsedAt} fallback="Never" className="text-muted-foreground" /> },
                        { id: "created", header: "Created", sortValue: (key) => asTime(key.createdAt), cell: (key) => <RelativeTime value={key.createdAt} className="text-muted-foreground" /> },
                        {
                          id: "actions",
                          header: "Actions",
                          hideHeader: true,
                          sortable: false,
                          align: "end",
                          cell: (key) => (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Rename ${key.name}`}
                                onClick={() => {
                                  setEditingKeyId(key.id);
                                  setEditingKeyName(key.name);
                                }}
                              >
                                <Edit className="size-4" />
                              </Button>
                              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${key.name}`} onClick={() => setDeletingKeyId(key.id)}>
                                <Trash className="size-4 text-danger" />
                              </Button>
                            </div>
                          ),
                        },
                      ] satisfies Column<any>[]}
                    />
                  )}
                </CardContent>
              </Card>
            </div>}

            {/* Appearance Section */}
            <div className="space-y-4">
              <SectionHeading title="Appearance" />

              <div className="divide-y divide-line rounded-[var(--radius-surface)] border border-line bg-card shadow-lit-drop">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <p id="color-mode-label" className="type-base font-medium">Color mode</p>
                  <Segmented
                    labelledBy="color-mode-label"
                    value={(mounted ? theme : "system") as "system" | "light" | "dark"}
                    onValueChange={handleThemeChange}
                    options={[
                      { value: "system", label: "System" },
                      { value: "light", label: "Light" },
                      { value: "dark", label: "Dark" },
                    ]}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="space-y-0.5">
                    <p id="motion-label" className="type-base font-medium">Motion</p>
                    <p className="type-small text-muted-foreground">
                      Reduced keeps brief fades and nothing moves; Off removes animation entirely.
                    </p>
                  </div>
                  <Segmented
                    labelledBy="motion-label"
                    value={motionPreference}
                    onValueChange={setMotionPreference}
                    options={[
                      { value: "system", label: "System" },
                      { value: "full", label: "Full" },
                      { value: "reduced", label: "Reduced" },
                      { value: "off", label: "Off" },
                    ]}
                  />
                </div>
              </div>
            </div>

            {/* Notifications Section */}
            {account && <div className="space-y-4">
              <SectionHeading title="Notifications" />

              <Form {...notificationsForm}>
                <form
                  onSubmit={notificationsForm.handleSubmit(
                    onNotificationsSubmit,
                  )}
                  className="space-y-4"
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>App notifications</CardTitle>
                      <CardDescription>
                        Configure alerts for your account activity
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <FormField
                        control={notificationsForm.control}
                        name="notifyLowCredits"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                Low credits
                              </FormLabel>
                              <FormDescription>
                                Alert when credits are running low
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={(value) => {
                                  field.onChange(value);
                                  notificationsForm.handleSubmit(
                                    onNotificationsSubmit,
                                  )();
                                }}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Email notifications</CardTitle>
                      <CardDescription>
                        Manage what emails you receive from us
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <FormField
                        control={notificationsForm.control}
                        name="emailNotifications"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                Email notifications
                              </FormLabel>
                              <FormDescription>
                                Receive important updates via email
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={(value) => {
                                  field.onChange(value);
                                  notificationsForm.handleSubmit(
                                    onNotificationsSubmit,
                                  )();
                                }}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <Separator />
                      <FormField
                        control={notificationsForm.control}
                        name="marketingEmails"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                Marketing emails
                              </FormLabel>
                              <FormDescription>
                                News, tips, and product updates
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={(value) => {
                                  field.onChange(value);
                                  notificationsForm.handleSubmit(
                                    onNotificationsSubmit,
                                  )();
                                }}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <Separator />
                      <FormField
                        control={notificationsForm.control}
                        name="securityAlerts"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                Security alerts
                              </FormLabel>
                              <FormDescription>
                                Critical security notifications
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={(value) => {
                                  field.onChange(value);
                                  notificationsForm.handleSubmit(
                                    onNotificationsSubmit,
                                  )();
                                }}
                                disabled
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>
                </form>
              </Form>
            </div>}

            {trailing}

            {account && <DeleteAccount />}
          </div>
        </div>

        {/* Enable 2FA Dialog */}
        {/* Enable 2FA Dialog */}
        <Dialog open={show2FADialog} onOpenChange={setShow2FADialog}>
          <DialogContent className="@min-[40rem]:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-foreground" />
                Enable two-factor authentication
              </DialogTitle>
              <DialogDescription>
                Scan the QR code with your authenticator app (e.g. Google
                Authenticator, Authy), then enter the 6-digit code below.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center justify-center py-4 space-y-6">
              {/* QR Code */}
              <div className="p-4 bg-paper rounded-xl border shadow-sm">
                {twoFactorUrl && (
                  <QRCodeCanvas
                    value={twoFactorUrl}
                    size={180}
                    level={"H"}
                    includeMargin={true}
                  />
                )}
              </div>

              {/* Secret Key Reveal */}
              <div className="w-full space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="type-base font-medium">
                    Setup key
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSecret(!showSecret)}
                  >
                    {showSecret ? <EyeOff /> : <Eye />}
                    {showSecret ? "Hide" : "Reveal"}
                  </Button>
                </div>

                {showSecret ? (
                  <div className="flex items-center gap-2 p-3 bg-surface rounded-lg border transition-all animate-in fade-in slide-in-from-top-1">
                    <code className="flex-1 text-sm font-mono break-all select-all text-center tracking-widest text-foreground">
                      {twoFactorSecret}
                    </code>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="shrink-0"
                      aria-label="Copy the setup key"
                      onClick={() => copyToClipboard(twoFactorSecret)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="p-3 bg-surface/50 rounded-lg border border-dashed flex items-center justify-center">
                    <span className="text-sm text-muted-foreground italic">
                      Click reveal to see the secret key
                    </span>
                  </div>
                )}
              </div>

              <Separator />

              {/* OTP Input */}
              <div className="space-y-3 w-full flex flex-col items-center">
                <Label>Verify code</Label>
                <InputOTP
                  maxLength={6}
                  value={otpCode}
                  onChange={(val) => setOtpCode(val)}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
                <p className="text-xs text-muted-foreground text-center">
                  Enter the 6-digit code from your app to confirm setup.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShow2FADialog(false);
                  setTwoFactorSecret("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmEnableTwoFactor}
                disabled={enabling2FA || otpCode.length !== 6}
              >
                {enabling2FA ? "Verifying..." : "Enable 2FA"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Disable 2FA Confirmation */}
        <AlertDialog
          open={showDisable2FAConfirm}
          onOpenChange={(open) => {
            setShowDisable2FAConfirm(open);
            if (!open) setDisable2FACode("");
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Turn off two-factor authentication?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Enter the 6-digit code from your authenticator app to confirm
                disabling 2FA.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col items-center py-4 space-y-3">
              <Label>Authentication code</Label>
              <InputOTP
                maxLength={6}
                value={disable2FACode}
                onChange={(val) => setDisable2FACode(val)}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDisableTwoFactor}
                disabled={disabling2FA || disable2FACode.length !== 6}
                className="bg-danger text-on-danger hover:bg-danger/90"
              >
                {disabling2FA ? "Disabling..." : "Disable 2FA"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* API Key Display Dialog */}
        <Dialog open={showApiKeyDialog} onOpenChange={setShowApiKeyDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>API Key Created</DialogTitle>
              <DialogDescription>
                Save this API key now. You won&apos;t be able to see it again!
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 p-3 bg-surface rounded-md">
                <code className="flex-1 text-sm break-all">
                  {createdApiKey}
                </code>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Copy the API key"
                  onClick={() =>
                    createdApiKey && copyToClipboard(createdApiKey)
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Make sure to copy your API key now. For security reasons, it
                won&apos;t be shown again.
              </p>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setShowApiKeyDialog(false);
                  setCreatedApiKey(null);
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete API Key Confirmation */}
        <AlertDialog
          open={deletingKeyId !== null}
          onOpenChange={(open) => !open && setDeletingKeyId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete your
                API key and any integrations using it will stop working
                immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  deletingKeyId && handleDeleteApiKey(deletingKeyId)
                }
                className="bg-danger text-on-danger hover:bg-danger/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Container>
  );
}

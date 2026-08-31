import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { QRCodeCanvas } from "qrcode.react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, Clipboard, Copy, Link2, MessageCircle, Phone, RefreshCw, Save, ShieldCheck, Sparkles, Wifi, X } from "lucide-react";

const ACTIONS = [
  ["whatsapp_bots", "WhatsApp Bots"], ["automation", "Automation"], ["deployment", "Deployment"],
  ["github", "GitHub"], ["contact", "Contact"], ["developer", "Developer"], ["firebox", "Open Firebox"]
] as const;
type ActionId = typeof ACTIONS[number][0];

type PersonaForm = {
  assistantName: string; tone: string; role: string; behaviorInstructions: string;
  welcomeMessage: string; guardrails: string; enabledActions: ActionId[];
};

const defaults: PersonaForm = {
  assistantName: "Firebox AI", tone: "Warm, concise, and capable", role: "WhatsApp automation guide",
  behaviorInstructions: "Answer naturally, ask one clarifying question when needed, and make the next best step obvious.",
  welcomeMessage: "Hi, I’m Firebox AI. What can I help you build today?",
  guardrails: "Never invent links, expose credentials, execute code, or claim an action was completed when it was not.",
  enabledActions: ACTIONS.map(([id]) => id)
};

function readPersona(data: any): PersonaForm {
  if (!data) return defaults;
  let enabled: ActionId[] = defaults.enabledActions;
  try { enabled = JSON.parse(data.enabledActions); } catch { /* safe default */ }
  return { assistantName: data.assistantName, tone: data.tone, role: data.role, behaviorInstructions: data.behaviorInstructions, welcomeMessage: data.welcomeMessage, guardrails: data.guardrails, enabledActions: enabled };
}

function StatusDot({ status }: { status: string }) {
  const active = status === "connected";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,.7)]" : "bg-amber-400"}`} />;
}

export default function Home() {
  // The control center is intentionally public; no sign-in is required for its actions.
  const { data, refetch } = trpc.controlCenter.overview.useQuery();
  const savePersona = trpc.controlCenter.savePersona.useMutation({ onSuccess: () => { toast.success("Persona saved", { description: "Your WhatsApp assistant will use this behavior." }); refetch(); }, onError: (e) => toast.error("Couldn’t save persona", { description: e.message }) });
  const resetPersona = trpc.controlCenter.resetPersona.useMutation({ onSuccess: (saved) => { setPersona(readPersona(saved)); toast.success("Persona reset"); }, onError: (e) => toast.error("Couldn’t reset persona", { description: e.message }) });
  const refreshQr = trpc.controlCenter.refreshQr.useMutation({ onSuccess: () => { refetch(); toast.success("New QR code ready"); }, onError: (e) => toast.error("Couldn’t generate QR", { description: e.message }) });
  const requestPairing = trpc.controlCenter.requestPairingCode.useMutation({ onSuccess: (result) => { setPairingCode(result.pairingCode); refetch(); toast.success("Pairing code ready"); }, onError: (e) => toast.error("Check the phone number", { description: e.message }) });
  const preview = trpc.controlCenter.preview.useMutation();
  const [persona, setPersona] = useState<PersonaForm>(defaults);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [location] = useLocation();
  const [section, setSection] = useState<"overview" | "connect" | "persona">(() => new URLSearchParams(window.location.search).get("section") as "overview" | "connect" | "persona" || "overview");
  const [previewMessages, setPreviewMessages] = useState<Message[]>([]);
  const session = data?.session;

  useEffect(() => { if (data?.persona) setPersona(readPersona(data.persona)); }, [data?.persona]);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { const querySection = new URLSearchParams(location.split("?")[1] ?? "").get("section"); if (querySection === "connect" || querySection === "persona") setSection(querySection); }, [location]);
  const connectionLabel = session?.status === "connected" ? "Connected" : session?.status === "waiting_qr" ? "Waiting for QR scan" : session?.status === "waiting_pairing" ? "Waiting for pairing" : "Not connected";
  const expires = session?.expiresAt ? new Date(session.expiresAt).getTime() : 0;
  const expired = Boolean(expires && expires < clock);
  const lastUpdated = session?.updatedAt ? new Date(session.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  const health = useMemo(() => [
    { label: "WhatsApp link", value: connectionLabel, good: session?.status === "connected" },
    { label: "Persona", value: persona.assistantName ? "Configured" : "Needs setup", good: Boolean(persona.assistantName) },
    { label: "Secure boundary", value: "Active", good: true }
  ], [connectionLabel, persona.assistantName, session?.status]);

  const update = <K extends keyof PersonaForm>(key: K, value: PersonaForm[K]) => setPersona(current => ({ ...current, [key]: value }));
  const toggleAction = (id: ActionId) => update("enabledActions", persona.enabledActions.includes(id) ? persona.enabledActions.filter(item => item !== id) : [...persona.enabledActions, id]);
  const fieldErrors = {
    assistantName: persona.assistantName.trim().length < 2 ? "Use at least 2 characters." : "",
    tone: persona.tone.trim().length < 2 ? "Add a tone so replies feel intentional." : "",
    role: persona.role.trim().length < 2 ? "Describe the assistant’s role." : "",
    behaviorInstructions: persona.behaviorInstructions.trim().length < 10 ? "Add at least 10 characters of behavior guidance." : "",
    welcomeMessage: persona.welcomeMessage.trim().length < 2 ? "Add a short welcome message." : "",
    guardrails: persona.guardrails.trim().length < 10 ? "Add at least one meaningful guardrail." : "",
    enabledActions: persona.enabledActions.length === 0 ? "Enable at least one action." : "",
  };
  const invalidFields = Object.entries(fieldErrors).filter(([, value]) => value).map(([key]) => key);
  const formValid = invalidFields.length === 0;
  const handlePreview = async (message: string) => {
    setPreviewMessages(current => [...current, { role: "user", content: message }]);
    const result = await preview.mutateAsync({ message });
    setPreviewMessages(current => [...current, { role: "assistant", content: result.message }]);
  };
  const copy = async (value: string, label: string) => { await navigator.clipboard.writeText(value); toast.success(`${label} copied`); };

  return <DashboardLayout>
    <div className="min-h-screen bg-[#f7f8f4] text-[#18221d] -m-4 lg:-m-6">
      <div className="mx-auto max-w-[1500px] px-5 py-6 sm:px-8 lg:px-10">
        <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.22em] text-[#678274]"><span className="h-2 w-2 rounded-full bg-[#da5d37]" /> Firebox Studios</div>
            <h1 className="max-w-3xl font-serif text-4xl tracking-[-.04em] text-[#1c2a22] sm:text-5xl">Your assistant, with a point of view.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#6d7c72]">Shape Firebox AI, pair its WhatsApp presence, and keep every interaction aligned with how you want to work.</p>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-[#dfe6dd] bg-white/80 px-4 py-2 text-sm shadow-sm"><StatusDot status={session?.status ?? "not_configured"} /><span className="font-medium">{connectionLabel}</span><span className="text-[#9aa99e]">·</span><span className="text-[#78877c]">Synced {lastUpdated}</span></div>
        </header>

        <nav className="mb-6 flex gap-2 overflow-x-auto border-b border-[#dfe6dd] pb-3">
          {[ ["overview", "Overview"], ["connect", "Connect WhatsApp"], ["persona", "Persona lab"] ].map(([id, label]) => <button key={id} onClick={() => setSection(id as typeof section)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${section === id ? "bg-[#1d2c24] text-white" : "text-[#728077] hover:bg-white hover:text-[#1d2c24]"}`}>{label}</button>)}
        </nav>

        {section === "overview" && <>
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            {health.map((item, index) => <Card key={item.label} className="border-0 bg-white/80 shadow-[0_10px_40px_rgba(33,56,42,.06)]"><CardContent className="flex items-center justify-between p-5"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#8a988e]">{item.label}</p><p className="mt-2 text-lg font-semibold text-[#26352c]">{item.value}</p></div><div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${item.good ? "bg-[#e8f3e9] text-[#3d7955]" : "bg-[#fff3dc] text-[#b97819]"}`}>{item.good ? <Check className="h-5 w-5" /> : <Wifi className="h-5 w-5" />}</div></CardContent></Card>)}
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
            <Card className="overflow-hidden border-0 bg-[#1d2c24] text-white shadow-[0_20px_60px_rgba(24,45,34,.16)]"><CardContent className="relative p-7 sm:p-9"><div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#d9e95c]/10 blur-3xl" /><div className="relative"><Badge className="border-0 bg-[#d9e95c] text-[#26351c]">Control center</Badge><h2 className="mt-6 max-w-xl font-serif text-4xl leading-[1.02] tracking-[-.04em]">One calm place to run the conversation.</h2><p className="mt-4 max-w-lg text-sm leading-6 text-[#c8d5cc]">Connect your WhatsApp account, tune the voice, and test the experience before your assistant speaks to a customer.</p><div className="mt-8 flex flex-wrap gap-3"><Button onClick={() => setSection("connect")} className="bg-[#d9e95c] text-[#1d2c24] hover:bg-[#e4f26d]"><MessageCircle className="mr-2 h-4 w-4" /> Set up WhatsApp</Button><Button onClick={() => setSection("persona")} variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"><Sparkles className="mr-2 h-4 w-4" /> Tune persona</Button></div></div></CardContent></Card>
            <Card className="border-0 bg-white/80 shadow-[0_10px_40px_rgba(33,56,42,.06)]"><CardHeader><div className="flex items-center justify-between"><div><CardTitle className="text-xl text-[#26352c]">Workspace summary</CardTitle><CardDescription className="mt-1">Shared Firebox workspace</CardDescription></div><ShieldCheck className="h-5 w-5 text-[#4d8c61]" /></div></CardHeader><CardContent className="space-y-4"><div className="rounded-2xl bg-[#f1f5ef] p-4"><p className="text-xs uppercase tracking-[.12em] text-[#8a988e]">Workspace</p><p className="mt-1 font-semibold">{data?.account.name ?? "Public Firebox workspace"}</p><p className="text-sm text-[#7c8c81]">{data?.account.email || "Available without sign-in"}</p></div><div className="flex items-center justify-between text-sm"><span className="text-[#7c8c81]">Active persona</span><span className="font-semibold">{persona.assistantName}</span></div><div className="flex items-center justify-between text-sm"><span className="text-[#7c8c81]">Enabled actions</span><span className="font-semibold">{persona.enabledActions.length} of {ACTIONS.length}</span></div></CardContent></Card>
          </div>
        </>}

        {section === "connect" && <div className="grid gap-6 xl:grid-cols-[.86fr_1.14fr]">
          <Card className="border-0 bg-white/85 shadow-[0_10px_40px_rgba(33,56,42,.06)]"><CardHeader><div className="flex items-center gap-3"><div className="rounded-2xl bg-[#eaf3e7] p-3 text-[#47845b]"><MessageCircle className="h-5 w-5" /></div><div><CardTitle className="text-xl">WhatsApp connection</CardTitle><CardDescription>Pair the account that will host Firebox AI.</CardDescription></div></div></CardHeader><CardContent className="space-y-5"><div className="flex items-start gap-3 rounded-2xl border border-[#e5ece2] bg-[#f8faf7] p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#4d8c61]" /><p className="text-sm leading-5 text-[#6d7c72]">Pairing codes expire quickly. Long-lived authentication keys and AI credentials stay on the server and never enter this browser.</p></div><div className="grid gap-3 sm:grid-cols-2"><Button onClick={() => refreshQr.mutate()} disabled={refreshQr.isPending} className="h-12 bg-[#1d2c24] hover:bg-[#2b4034]">{refreshQr.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Generate QR</Button><Button onClick={() => document.getElementById("pairing")?.scrollIntoView({ behavior: "smooth" })} variant="outline" className="h-12 border-[#d7e1d5] bg-white"><Phone className="mr-2 h-4 w-4" /> Use phone code</Button></div><Separator /><div className="rounded-2xl border border-[#e5ece2] p-5"><div className="flex items-center justify-between"><div><p className="font-semibold">Current state</p><p className="mt-1 text-sm text-[#7d8c82]">{connectionLabel}</p></div><Badge variant="outline" className="border-[#cfe0d0] text-[#4d8c61]"><StatusDot status={session?.status ?? "not_configured"} /> <span className="ml-2">{session?.status ?? "not configured"}</span></Badge></div></div></CardContent></Card>
          <div className="space-y-6"><Card className="border-0 bg-white/85 shadow-[0_10px_40px_rgba(33,56,42,.06)]"><CardHeader><CardTitle className="text-xl">Scan to connect</CardTitle><CardDescription>Open WhatsApp → Linked devices → Link a device.</CardDescription></CardHeader><CardContent><div className="flex min-h-[280px] items-center justify-center rounded-3xl bg-[#f1f5ef] p-8">{session?.qrImage && !expired ? <div className="flex flex-col items-center"><div className="rounded-2xl bg-white p-4 shadow-sm"><img src={session.qrImage} alt="Secure WhatsApp pairing QR code" className="h-[190px] w-[190px]" /></div><div className="mt-4 flex items-center gap-2 text-sm text-[#708177]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#d08a2f]" /> Secure QR · expires soon</div></div> : <div className="text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-white text-[#9aaa9e]"><RefreshCw className="h-7 w-7" /></div><p className="font-semibold">{expired ? "QR code expired" : "No active QR code"}</p><p className="mt-1 text-sm text-[#7d8c82]">{session?.status === "error" ? "The live WhatsApp service could not issue a QR code." : expired ? "Generate a fresh code and scan it within two minutes." : "Generate a fresh code to begin pairing."}</p><Button onClick={() => refreshQr.mutate()} disabled={refreshQr.isPending} className="mt-5 bg-[#1d2c24]">{expired ? "Retry pairing" : "Generate QR"}</Button>{(refreshQr.error?.message || session?.lastError) && <p className="mt-3 text-xs text-[#a16145]">{refreshQr.error?.message || session?.lastError}</p>}</div>}</div></CardContent></Card>
            <Card id="pairing" className="border-0 bg-[#fffaf0] shadow-[0_10px_40px_rgba(90,66,24,.06)]"><CardHeader><CardTitle className="text-xl">Pair with a phone number</CardTitle><CardDescription>Use this when scanning a QR code is inconvenient.</CardDescription></CardHeader><CardContent><div className="flex gap-2"><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+254 769 564 723" className="h-11 border-[#eadfca] bg-white" /><Button onClick={() => requestPairing.mutate({ phoneNumber: phone.replace(/\s/g, "") })} disabled={requestPairing.isPending || !phone} className="h-11 bg-[#bd6d2b] hover:bg-[#a95c21]">{requestPairing.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Get code"}</Button></div>{pairingCode && !expired && <div className="mt-5 flex items-center justify-between rounded-2xl border border-[#eadfca] bg-white p-4"><div><p className="text-xs uppercase tracking-[.13em] text-[#9c8a6d]">Temporary pairing code</p><p className="mt-1 font-mono text-2xl font-bold tracking-[.16em] text-[#74471f]">{pairingCode}</p></div><Button variant="outline" onClick={() => copy(pairingCode, "Pairing code")} className="border-[#eadfca] bg-white"><Clipboard className="mr-2 h-4 w-4" /> Copy</Button></div>}{pairingCode && expired && <div className="mt-5 rounded-2xl border border-[#edcfc2] bg-[#fff4ef] p-4 text-sm text-[#9a543d]"><p className="font-semibold">Pairing code expired</p><p className="mt-1">Request a new code to retry.</p></div>}{requestPairing.error && <p className="mt-3 text-xs text-[#a16145]">{requestPairing.error.message}</p>}</CardContent></Card>
          </div>
        </div>}

        {section === "persona" && <div className="grid gap-6 xl:grid-cols-[1fr_.78fr]">
          <Card className="border-0 bg-white/85 shadow-[0_10px_40px_rgba(33,56,42,.06)]"><CardHeader><div className="flex items-center justify-between"><div><CardTitle className="text-xl">Persona lab</CardTitle><CardDescription>Give your assistant a recognizable voice.</CardDescription></div><Sparkles className="h-5 w-5 text-[#d06a42]" /></div></CardHeader><CardContent className="space-y-6">{!data?.persona && <div className="rounded-2xl border border-dashed border-[#c9dfc7] bg-[#f5faf3] p-4 text-sm text-[#54755c]"><p className="font-semibold">Your persona is ready for its first save.</p><p className="mt-1">Start with the Firebox defaults, then shape the voice around your customers.</p></div>}<div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Assistant name</Label><Input aria-invalid={Boolean(fieldErrors.assistantName)} value={persona.assistantName} onChange={e => update("assistantName", e.target.value)} />{fieldErrors.assistantName && <p className="text-xs text-[#a16145]">{fieldErrors.assistantName}</p>}</div><div className="space-y-2"><Label>Tone</Label><Input aria-invalid={Boolean(fieldErrors.tone)} value={persona.tone} onChange={e => update("tone", e.target.value)} />{fieldErrors.tone && <p className="text-xs text-[#a16145]">{fieldErrors.tone}</p>}</div></div><div className="space-y-2"><Label>Role</Label><Input aria-invalid={Boolean(fieldErrors.role)} value={persona.role} onChange={e => update("role", e.target.value)} />{fieldErrors.role && <p className="text-xs text-[#a16145]">{fieldErrors.role}</p>}</div><div className="space-y-2"><Label>Behavior instructions</Label><Textarea aria-invalid={Boolean(fieldErrors.behaviorInstructions)} value={persona.behaviorInstructions} onChange={e => update("behaviorInstructions", e.target.value)} className="min-h-[110px] resize-y" />{fieldErrors.behaviorInstructions && <p className="text-xs text-[#a16145]">{fieldErrors.behaviorInstructions}</p>}</div><div className="space-y-2"><Label>Welcome message</Label><Textarea aria-invalid={Boolean(fieldErrors.welcomeMessage)} value={persona.welcomeMessage} onChange={e => update("welcomeMessage", e.target.value)} className="min-h-[85px] resize-y" />{fieldErrors.welcomeMessage && <p className="text-xs text-[#a16145]">{fieldErrors.welcomeMessage}</p>}</div><div className="space-y-2"><Label>Guardrails</Label><Textarea aria-invalid={Boolean(fieldErrors.guardrails)} value={persona.guardrails} onChange={e => update("guardrails", e.target.value)} className="min-h-[110px] resize-y" />{fieldErrors.guardrails && <p className="text-xs text-[#a16145]">{fieldErrors.guardrails}</p>}</div><div><Label>Enabled conversation actions</Label><div className="mt-3 flex flex-wrap gap-2">{ACTIONS.map(([id, label]) => { const enabled = persona.enabledActions.includes(id); return <button type="button" key={id} onClick={() => toggleAction(id)} className={`rounded-full border px-3 py-2 text-sm transition ${enabled ? "border-[#c9dfc7] bg-[#eaf3e7] text-[#356745]" : "border-[#e1e8df] bg-white text-[#8a988e]"}`}>{enabled ? <Check className="mr-1.5 inline h-3.5 w-3.5" /> : <X className="mr-1.5 inline h-3.5 w-3.5" />}{label}</button> })}</div></div>{invalidFields.length > 0 && <div className="rounded-2xl border border-[#edcfc2] bg-[#fff4ef] p-3 text-sm text-[#9a543d]">Complete these fields before saving: <span className="font-semibold">{invalidFields.join(", ")}</span></div>}<div className="flex flex-wrap gap-3 border-t border-[#e3e9e1] pt-5"><Button onClick={() => savePersona.mutate(persona)} disabled={savePersona.isPending || !formValid} className="bg-[#1d2c24] hover:bg-[#2b4034]"><Save className="mr-2 h-4 w-4" /> {savePersona.isPending ? "Saving…" : "Save persona"}</Button><Button variant="ghost" onClick={() => data?.persona && setPersona(readPersona(data.persona))}>Discard changes</Button><Button variant="ghost" onClick={() => resetPersona.mutate()} disabled={resetPersona.isPending} className="ml-auto text-[#a16145]">Reset to default</Button></div></CardContent></Card>
          <Card className="border-0 bg-[#1d2c24] text-white shadow-[0_20px_60px_rgba(24,45,34,.16)]"><CardHeader><div className="flex items-center justify-between"><div><CardTitle className="text-xl text-white">Live assistant preview</CardTitle><CardDescription className="text-[#b8c8bc]">Test the saved voice before going live.</CardDescription></div><div className="rounded-2xl bg-white/10 p-2.5"><Sparkles className="h-4 w-4 text-[#d9e95c]" /></div></div></CardHeader><CardContent><div className="rounded-2xl bg-[#17241d] p-2"><AIChatBox messages={previewMessages} onSendMessage={handlePreview} isLoading={preview.isPending} placeholder="Try: I need a WhatsApp bot" emptyStateMessage={persona.welcomeMessage} /></div></CardContent></Card>
        </div>}
      </div>
    </div>
  </DashboardLayout>;
}

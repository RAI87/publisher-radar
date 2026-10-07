import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SteamSnapshot } from "./steam.js";
import { hashPass, checkPass, newToken } from "./auth.js";

export interface TrackedGame {
  appId: string;
  label: string;
  mine: boolean;
  addedAt: string;
}

export interface Alert {
  id: string;
  at: string;
  appId: string;
  kind: string;
  text: string;
}

export interface User {
  id: string;
  email: string;
  passHash: string;
  salt: string;
  googleId: string | null;
  plan: "trial" | "starter" | "pro";
  pendingPro: boolean;
  wantPlan: string;
  wantPeriod: string;
  proUntil: string | null;
  trialEnds: string;
  createdAt: string;
}

export interface UserData {
  games: TrackedGame[];
  history: SteamSnapshot[];
  alerts: Alert[];
  webhook: string;
  steamworksKey: string;
}

interface DB {
  users: User[];
  sessions: { token: string; userId: string; createdAt: string }[];
  resets: { token: string; userId: string; until: string }[];
  data: Record<string, UserData>;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.env.DATA_DIR || root;
const file = join(dir, "data.json");

function blankData(): UserData {
  return { games: [], history: [], alerts: [], webhook: "", steamworksKey: "" };
}

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const sessionAlive = (iso: string): boolean =>
  Date.now() - new Date(iso).getTime() < SESSION_DAYS * 86400000;

function load(): DB {
  if (!existsSync(file)) return { users: [], sessions: [], resets: [], data: {} };
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as any;
  } catch {
    try {
      copyFileSync(file, file + ".corrupt-" + Date.now() + ".json");
    } catch {}
    return { users: [], sessions: [], resets: [], data: {} };
  }
  try {
    if (Array.isArray(raw.users)) {
      for (const u of raw.users) {
        if (u.googleId === undefined) u.googleId = null;
        if (u.pendingPro === undefined) u.pendingPro = false;
        if (!u.wantPlan) u.wantPlan = "pro";
        if (!u.wantPeriod) u.wantPeriod = "monthly";
        if (u.proUntil === undefined) u.proUntil = null;
      }
      return { users: raw.users, sessions: raw.sessions ?? [], resets: raw.resets ?? [], data: raw.data ?? {} };
    }
    const migrated: DB = { users: [], sessions: [], resets: [], data: {} };
    const uid = "piloto";
    migrated.users.push({
      id: uid,
      email: "piloto@local",
      passHash: "",
      salt: "",
      googleId: null,
      plan: "trial",
      pendingPro: false,
      wantPlan: "pro",
      wantPeriod: "monthly",
      proUntil: null,
      trialEnds: new Date(Date.now() + 7 * 86400000).toISOString(),
      createdAt: new Date().toISOString()
    });
    migrated.data[uid] = {
      games: raw.games ?? [],
      history: raw.history ?? [],
      alerts: raw.alerts ?? [],
      webhook: raw.config?.webhook ?? "",
      steamworksKey: ""
    };
    return migrated;
  } catch {
    return { users: [], sessions: [], resets: [], data: {} };
  }
}

function save(db: DB): void {
  db.sessions = db.sessions.filter((s) => sessionAlive(s.createdAt)).slice(-500);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, file);
}

function ud(db: DB, userId: string): UserData {
  if (!db.data[userId]) db.data[userId] = blankData();
  return db.data[userId];
}

function trialLeft(u: User): number {
  return Math.max(0, Math.ceil((new Date(u.trialEnds).getTime() - Date.now()) / 86400000));
}

export const storage = {
  register(email: string, pass: string): { user: User; token: string } {
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error("email inválido");
    if (pass.length < 6) throw new Error("senha mínima de 6 caracteres");
    const db = load();
    if (db.users.find((u) => u.email === clean)) throw new Error("email já cadastrado — faça login");
    const { hash, salt } = hashPass(pass);
    const user: User = {
      id: "u" + Date.now().toString(36),
      email: clean,
      passHash: hash,
      salt,
      googleId: null,
      plan: "trial",
      pendingPro: false,
      wantPlan: "pro",
      wantPeriod: "monthly",
      proUntil: null,
      trialEnds: new Date(Date.now() + 7 * 86400000).toISOString(),
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    ud(db, user.id);
    const token = newToken();
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    save(db);
    return { user, token };
  },
  login(email: string, pass: string): { user: User; token: string } {
    const clean = email.trim().toLowerCase();
    const db = load();
    const user = db.users.find((u) => u.email === clean);
    if (!user || !user.passHash) throw new Error("login inválido");
    if (!checkPass(pass, user.salt, user.passHash)) throw new Error("login inválido");
    const token = newToken();
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    db.sessions = db.sessions.slice(-200);
    save(db);
    return { user, token };
  },
  logout(token: string): void {
    const db = load();
    db.sessions = db.sessions.filter((s) => s.token !== token);
    save(db);
  },
  findOrCreateGoogle(googleId: string, email: string): { user: User; token: string; created: boolean } {
    const clean = email.trim().toLowerCase();
    const db = load();
    let user = db.users.find((u) => u.googleId === googleId) ?? db.users.find((u) => u.email === clean);
    let created = false;
    if (!user) {
      user = {
        id: "u" + Date.now().toString(36),
        email: clean,
        passHash: "",
        salt: "",
        googleId,
        plan: "trial",
        pendingPro: false,
        wantPlan: "pro",
        wantPeriod: "monthly",
        proUntil: null,
        trialEnds: new Date(Date.now() + 7 * 86400000).toISOString(),
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      ud(db, user.id);
      created = true;
    } else if (!user.googleId) {
      user.googleId = googleId;
    }
    const token = newToken();
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    db.sessions = db.sessions.slice(-500);
    save(db);
    return { user, token, created };
  },
  issueReset(email: string): { token: string; userId: string } {
    const clean = email.trim().toLowerCase();
    const db = load();
    const user = db.users.find((u) => u.email === clean);
    if (!user) throw new Error("se este email existe, enviamos o link");
    const token = newToken();
    db.resets.push({ token, userId: user.id, until: new Date(Date.now() + 3600000).toISOString() });
    db.resets = db.resets.slice(-200);
    save(db);
    return { token, userId: user.id };
  },
  consumeReset(token: string, pass: string): void {
    if (pass.length < 6) throw new Error("senha mínima de 6 caracteres");
    const db = load();
    const r = db.resets.find((x) => x.token === token);
    if (!r || new Date(r.until).getTime() < Date.now()) throw new Error("link expirado — peça outro");
    const user = db.users.find((x) => x.id === r.userId);
    if (!user) throw new Error("conta não encontrada");
    const { hash, salt } = hashPass(pass);
    user.passHash = hash;
    user.salt = salt;
    db.resets = db.resets.filter((x) => x.token !== token);
    save(db);
  },
  adminSetPass(email: string, pass: string): boolean {
    if (pass.length < 6) return false;
    const db = load();
    const u = db.users.find((x) => x.email === email.trim().toLowerCase());
    if (!u) return false;
    const { hash, salt } = hashPass(pass);
    u.passHash = hash;
    u.salt = salt;
    save(db);
    return true;
  },
  deleteUser(userId: string): void {
    const db = load();
    db.users = db.users.filter((u) => u.id !== userId);
    delete db.data[userId];
    db.sessions = db.sessions.filter((s) => s.userId !== userId);
    save(db);
  },
  me(token: string): (User & { trialLeft: number }) | null {
    const db = load();
    const s = db.sessions.find((x) => x.token === token);
    if (!s || !sessionAlive(s.createdAt)) return null;
    const u = db.users.find((x) => x.id === s.userId);
    if (!u) return null;
    if (u.pendingPro === undefined) u.pendingPro = false;
    if (!u.wantPlan) u.wantPlan = "pro";
    if (!u.wantPeriod) u.wantPeriod = "monthly";
    if (u.proUntil === undefined) u.proUntil = null;
    return { ...u, trialLeft: u.plan === "trial" ? trialLeft(u) : -1 };
  },
  allUserIds(): string[] {
    return load().users.map((u) => u.id);
  },
  userEmail(userId: string): string {
    return load().users.find((u) => u.id === userId)?.email ?? userId;
  },
  trialOk(userId: string): boolean {
    const u = load().users.find((x) => x.id === userId);
    if (!u) return false;
    if (u.plan !== "trial") {
      if (!u.proUntil) return true;
      return new Date(u.proUntil).getTime() > Date.now();
    }
    return trialLeft(u) > 0;
  },
  stats(): { users: number; sessions: number; games: number; snapshots: number; alerts: number } {
    const db = load();
    const ids = Object.keys(db.data);
    return {
      users: db.users.length,
      sessions: db.sessions.length,
      games: ids.reduce((a, k) => a + (db.data[k]?.games.length ?? 0), 0),
      snapshots: ids.reduce((a, k) => a + (db.data[k]?.history.length ?? 0), 0),
      alerts: ids.reduce((a, k) => a + (db.data[k]?.alerts.length ?? 0), 0)
    };
  },
  setPlan(email: string, plan: "trial" | "starter" | "pro", months = 1): boolean {
    const db = load();
    const u = db.users.find((x) => x.email === email.trim().toLowerCase());
    if (!u) return false;
    u.plan = plan;
    u.pendingPro = false;
    u.proUntil = plan === "trial" ? null : new Date(Date.now() + months * 30 * 86400000).toISOString();
    save(db);
    return true;
  },
  markPaid(userId: string, plan = "pro", period = "monthly"): void {
    const db = load();
    const u = db.users.find((x) => x.id === userId);
    if (!u) return;
    u.pendingPro = true;
    u.wantPlan = plan;
    u.wantPeriod = period;
    save(db);
  },
  pendingList(): { email: string; want: string; since: string }[] {
    const db = load();
    return db.users.filter((u) => u.pendingPro && u.plan === "trial").map((u) => ({ email: u.email, want: (u.wantPlan || "pro") + "/" + (u.wantPeriod || "monthly"), since: u.createdAt }));
  },
  listGames(userId: string): TrackedGame[] {
    return load().data[userId]?.games ?? [];
  },
  addGame(userId: string, appId: string, mine: boolean, label = ""): TrackedGame {
    const db = load();
    const d = ud(db, userId);
    const clean = appId.trim();
    if (!/^\d+$/.test(clean)) throw new Error("appId inválido, use só números");
    const me = db.users.find((x) => x.id === userId);
    const limit = me?.plan === "starter" ? 10 : 30;
    if (d.games.length >= limit) throw new Error(`limite de ${limit} jogos no seu plano — suba para o Pro`);
    const ex = d.games.find((g) => g.appId === clean);
    if (!ex) {
      d.games.push({ appId: clean, label, mine, addedAt: new Date().toISOString() });
      save(db);
    } else if (label) {
      ex.label = label;
      ex.mine = mine;
      save(db);
    }
    return d.games.find((g) => g.appId === clean)!;
  },
  removeGame(userId: string, appId: string): boolean {
    const db = load();
    const d = ud(db, userId);
    const before = d.games.length;
    d.games = d.games.filter((g) => g.appId !== appId);
    save(db);
    return d.games.length < before;
  },
  pushSnapshot(userId: string, s: SteamSnapshot): void {
    const db = load();
    const d = ud(db, userId);
    d.history.push(s);
    d.history = d.history.slice(-2000);
    save(db);
  },
  lastSnapshot(userId: string, appId: string): SteamSnapshot | null {
    const h = (load().data[userId]?.history ?? []).filter((x) => x.appId === appId);
    return h.length ? h[h.length - 1] : null;
  },
  historyFor(userId: string, appId: string, limit = 30): SteamSnapshot[] {
    return (load().data[userId]?.history ?? []).filter((x) => x.appId === appId).slice(-limit);
  },
  pushAlert(userId: string, a: Omit<Alert, "id" | "at">): Alert {
    const db = load();
    const d = ud(db, userId);
    const full: Alert = { ...a, id: String(Date.now()) + Math.floor(Math.random() * 999), at: new Date().toISOString() };
    d.alerts.push(full);
    d.alerts = d.alerts.slice(-500);
    save(db);
    return full;
  },
  listAlerts(userId: string): Alert[] {
    return (load().data[userId]?.alerts ?? []).slice().reverse();
  },
  getWebhook(userId: string): string {
    if (process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL;
    return load().data[userId]?.webhook || "";
  },
  setWebhook(userId: string, url: string): void {
    const db = load();
    ud(db, userId).webhook = url.trim();
    save(db);
  },
  getKey(userId: string): string {
    return load().data[userId]?.steamworksKey || "";
  },
  setKey(userId: string, key: string): void {
    const db = load();
    ud(db, userId).steamworksKey = key.trim();
    save(db);
  },
  seedDemo(userId: string): void {
    const db = load();
    const d = ud(db, userId);
    if (d.games.length) return;
    const now = new Date().toISOString();
    d.games = [
      { appId: "557040", label: "99Vidas (QUByte)", mine: true, addedAt: now },
      { appId: "1903560", label: "Atomic Picnic (BitCake)", mine: false, addedAt: now },
      { appId: "3897390", label: "Sportia (Hermit Crab)", mine: false, addedAt: now }
    ];
    save(db);
  }
};

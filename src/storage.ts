import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
  plan: "trial" | "pro";
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
  data: Record<string, UserData>;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "data.json");

function blankData(): UserData {
  return { games: [], history: [], alerts: [], webhook: "", steamworksKey: "" };
}

function load(): DB {
  if (!existsSync(file)) return { users: [], sessions: [], data: {} };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as any;
    if (Array.isArray(raw.users)) {
      return { users: raw.users, sessions: raw.sessions ?? [], data: raw.data ?? {} };
    }
    const migrated: DB = { users: [], sessions: [], data: {} };
    const uid = "piloto";
    migrated.users.push({
      id: uid,
      email: "piloto@local",
      passHash: "",
      salt: "",
      plan: "trial",
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
    return { users: [], sessions: [], data: {} };
  }
}

function save(db: DB): void {
  writeFileSync(file, JSON.stringify(db, null, 2));
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
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error("email invalido");
    if (pass.length < 6) throw new Error("senha minima de 6 caracteres");
    const db = load();
    if (db.users.find((u) => u.email === clean)) throw new Error("email ja cadastrado — faca login");
    const { hash, salt } = hashPass(pass);
    const user: User = {
      id: "u" + Date.now().toString(36),
      email: clean,
      passHash: hash,
      salt,
      plan: "trial",
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
    if (!user || !user.passHash) throw new Error("login invalido");
    if (!checkPass(pass, user.salt, user.passHash)) throw new Error("login invalido");
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
  me(token: string): (User & { trialLeft: number }) | null {
    const db = load();
    const s = db.sessions.find((x) => x.token === token);
    if (!s) return null;
    const u = db.users.find((x) => x.id === s.userId);
    if (!u) return null;
    return { ...u, trialLeft: u.plan === "pro" ? -1 : trialLeft(u) };
  },
  allUserIds(): string[] {
    return load().users.map((u) => u.id);
  },
  userEmail(userId: string): string {
    return load().users.find((u) => u.id === userId)?.email ?? userId;
  },
  setPlan(email: string, plan: "trial" | "pro"): boolean {
    const db = load();
    const u = db.users.find((x) => x.email === email.trim().toLowerCase());
    if (!u) return false;
    u.plan = plan;
    save(db);
    return true;
  },
  listGames(userId: string): TrackedGame[] {
    return load().data[userId]?.games ?? [];
  },
  addGame(userId: string, appId: string, mine: boolean, label = ""): TrackedGame {
    const db = load();
    const d = ud(db, userId);
    const clean = appId.trim();
    if (!/^\d+$/.test(clean)) throw new Error("appId invalido, use so numeros");
    if (d.games.length >= 30) throw new Error("limite de 30 jogos no plano piloto");
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

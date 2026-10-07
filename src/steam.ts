export interface SteamSnapshot {
  appId: string;
  name: string;
  priceBRL: number | null;
  discountPct: number;
  totalReviews: number;
  positivePct: number;
  ccu: number;
  capsule: string;
  url: string;
  shortLen: number;
  shots: number;
  trailers: number;
  audit: number;
  auditIssues: string[];
  fetchedAt: string;
}

export interface RecentReview {
  positive: boolean;
  hours: number;
  text: string;
  hoursPlayed: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, { headers: { "User-Agent": "PublisherRadar/0.2" } });
    if (res.status === 429 && i < retries) {
      await sleep(2500 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error("Falha apos retries");
}

export async function fetchSnapshot(appId: string): Promise<SteamSnapshot> {
  const [details, reviews, ccu] = await Promise.all([
    getJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=BR&l=portuguese`),
    getJson(`https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`),
    getJson(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appId}`).catch(() => null)
  ]);

  const data = details?.[appId]?.data;
  if (!data) throw new Error(`App ${appId} nao encontrado ou privado`);

  const overview = data.price_overview ?? null;
  const summary = reviews?.query_summary ?? {};
  const shortLen = String(data.short_description ?? "").length;
  const shots: number = Array.isArray(data.screenshots) ? data.screenshots.length : 0;
  const trailers: number = Array.isArray(data.movies) ? data.movies.length : 0;

  const issues: string[] = [];
  if (shortLen > 0 && shortLen < 150) issues.push(`Descricao curta com ${shortLen} caracteres (ideal 200-300, genero na 1a frase)`);
  if (shortLen === 0) issues.push("Sem descricao curta publica");
  if (shots < 5) issues.push(`So ${shots} screenshots (ideal 8+, gameplay nos 3 primeiros)`);
  if (trailers < 1) issues.push("Sem trailer — gameplay nos 10s iniciais e thumbnail dedicada");
  let audit = 100 - issues.length * 18;
  if (data.release_date?.coming_soon) audit = Math.min(audit, 88);
  audit = Math.max(20, Math.min(100, audit));

  return {
    appId,
    name: String(data.name ?? appId),
    priceBRL: overview ? overview.final / 100 : null,
    discountPct: overview ? Number(overview.discount_percent ?? 0) : 0,
    totalReviews: Number(summary.total_reviews ?? 0),
    positivePct: summary.total_reviews
      ? Math.round((Number(summary.total_positive ?? 0) / Number(summary.total_reviews)) * 100)
      : 0,
    ccu: Number(ccu?.response?.player_count ?? 0),
    capsule: String(data.header_image ?? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`),
    url: `https://store.steampowered.com/app/${appId}`,
    shortLen,
    shots,
    trailers,
    audit,
    auditIssues: issues,
    fetchedAt: new Date().toISOString()
  };
}

export async function fetchRecentNegatives(appId: string, days = 1): Promise<number> {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const j = await getJson(
    `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=20`
  );
  const list: any[] = j?.reviews ?? [];
  return list.filter((r) => {
    const t = Number(r?.timestamp_created ?? 0) * 1000;
    return t >= cutoff && r?.voted_up === false;
  }).length;
}

export async function fetchRecentReviews(appId: string, n = 3): Promise<RecentReview[]> {
  const j = await getJson(
    `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=${n}`
  ).catch(() => null);
  const list: any[] = j?.reviews ?? [];
  return list.slice(0, n).map((r) => ({
    positive: r?.voted_up !== false,
    hours: Math.round(Number(r?.author?.playtime_forever ?? 0) / 60),
    text: String(r?.review ?? "").slice(0, 280),
    hoursPlayed: Math.round(Number(r?.author?.playtime_forever ?? 0) / 60)
  }));
}

const BANDS: { name: string; min: number }[] = [
  { name: "Largely Negative", min: 0 },
  { name: "Mixed", min: 40 },
  { name: "Mostly Positive", min: 70 },
  { name: "Positive", min: 80 },
  { name: "Very Positive", min: 85 },
  { name: "Overwhelmingly Positive", min: 95 }
];

export function scoreForecast(total: number, posPct: number): { band: string; next: string | null; need: number } {
  const ratio = total ? posPct / 100 : 0;
  let idx = 0;
  for (let i = 0; i < BANDS.length; i++) if (ratio * 100 >= BANDS[i].min) idx = i;
  const band = total < 10 ? "Sem nota (menos de 10 reviews)" : BANDS[idx].name;
  if (total < 10) return { band, next: null, need: 0 };
  const nxt = BANDS[idx + 1] ?? null;
  if (!nxt) return { band, next: null, need: 0 };
  const P = Math.round((posPct / 100) * total);
  const t = nxt.min / 100;
  const need = Math.max(0, Math.ceil((t * total - P) / (1 - t)));
  return { band, next: nxt.name, need };
}

export function draftReply(game: string, review: RecentReview): { pt: string; en: string } {
  const tema = review.text ? `"${review.text.slice(0, 120)}..."` : "seu relato";
  return {
    pt: `Obrigado por jogar ${game} e pelo feedback sobre ${tema} Levamos a serio e ja registramos para a proxima atualizacao. Se puder, conte em qual ponto travou (minuto/tela) para reproduzirmos aqui.`,
    en: `Thanks for playing ${game} and flagging ${tema} We logged it for the next patch. Could you share where it happened (minute/screen) so we can reproduce it here?`
  };
}

export function parseAppId(input: string): string | null {
  const clean = String(input).split("?")[0];
  const m = clean.match(/\/app\/(\d+)/) ?? clean.trim().match(/^(\d{3,10})$/);
  return m ? m[1] : null;
}

export function extractAppIds(text: string): string[] {
  const out: string[] = [];
  for (const token of String(text).split(/[\s,;]+/)) {
    if (!token) continue;
    const id = parseAppId(token);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= 30) break;
  }
  return out;
}

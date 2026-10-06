import { fetchSnapshot, fetchRecentNegatives } from "./steam.js";
import { storage } from "./storage.js";
import { sendRadarEmbed } from "./discord.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runUser(userId: string): Promise<string[]> {
  const out: string[] = [];
  for (const g of storage.listGames(userId)) {
    try {
      const prev = storage.lastSnapshot(userId, g.appId);
      const cur = await fetchSnapshot(g.appId);
      storage.pushSnapshot(userId, cur);
      const changes: { text: string; kind: string }[] = [];
      if (!prev) {
        changes.push({ text: `Primeira coleta: R$ ${cur.priceBRL} | ${cur.totalReviews} reviews`, kind: "auto" });
      } else {
        if ((prev.priceBRL ?? null) !== (cur.priceBRL ?? null)) {
          changes.push({ text: `Preco R$ ${prev.priceBRL} para R$ ${cur.priceBRL} (${cur.discountPct}% off)`, kind: "price" });
        }
        const d = cur.totalReviews - prev.totalReviews;
        if (d >= 5) changes.push({ text: `Mais ${d} reviews no ciclo`, kind: "auto" });
        if (Math.abs(cur.positivePct - prev.positivePct) >= 2 && cur.totalReviews > 20) {
          changes.push({ text: `Aprovacao ${prev.positivePct}% para ${cur.positivePct}%`, kind: "rating" });
        }
      }
      try {
        const neg = await fetchRecentNegatives(g.appId, 1);
        if (neg >= 3) changes.push({ text: `${neg} avaliações negativas nas últimas 24h`, kind: "review-bomb" });
      } catch {}
      for (const c of changes) storage.pushAlert(userId, { appId: g.appId, kind: c.kind, text: `${cur.name}: ${c.text}` });
      if (changes.length) await sendRadarEmbed(userId, cur, changes.map((c) => c.text));
      out.push(`${storage.userEmail(userId)} / ${cur.name}: ${changes.length ? changes.length + " mudanca(s)" : "sem novidades"}`);
    } catch (e) {
      out.push(`${userId}/${g.appId}: ${e instanceof Error ? e.message : "falha"}`);
    }
    await sleep(1500);
  }
  return out;
}

const users = storage.allUserIds();
if (!users.length) console.log("Nenhum usuario. Crie conta em /login primeiro.");
for (const u of users) {
  for (const line of await runUser(u)) console.log(line);
}

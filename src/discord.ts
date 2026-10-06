import { storage } from "./storage.js";
import type { SteamSnapshot } from "./steam.js";

export async function sendDiscord(userId: string, text: string): Promise<{ simulated: boolean }> {
  const url = storage.getWebhook(userId);
  if (!url) {
    console.log(`[discord:${userId}] sem webhook, so log:\n` + text);
    return { simulated: true };
  }
  if (!url.startsWith("https://discord.com/api/webhooks/")) {
    throw new Error("Webhook inválido — use o URL copiado em Canal > Integracoes > Webhooks");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text.slice(0, 1900) })
  });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
  return { simulated: false };
}

export async function sendRadarEmbed(userId: string, snap: SteamSnapshot, changes: string[]): Promise<{ simulated: boolean }> {
  const url = storage.getWebhook(userId);
  const title = changes.length ? `${snap.name} — ${changes.length} alteracao(oes)` : `${snap.name} — sem novidades`;
  const desc =
    `Preco: R$ ${snap.priceBRL ?? "a anunciar"}${snap.discountPct ? ` (${snap.discountPct}% off)` : ""} | ${snap.totalReviews} reviews, ${snap.positivePct}% aprovacao, ${snap.ccu} online\n` +
    (changes.length ? changes.map((c) => `- ${c}`).join("\n") : "Nada relevante desde a ultima coleta.") +
    `\nAbrir na Steam: ${snap.url}`;
  if (!url) {
    console.log(`[discord-embed:${userId}]\n` + title + "\n" + desc);
    return { simulated: true };
  }
  if (!url.startsWith("https://discord.com/api/webhooks/")) {
    throw new Error("Webhook inválido");
  }
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: title.slice(0, 256),
          description: desc.slice(0, 4000),
          url: snap.url,
          color: 5814783,
          thumbnail: { url: snap.capsule },
          timestamp: new Date().toISOString(),
          footer: { text: "Publisher Radar · Steam API oficial" }
        }
      ]
    })
  });
  return { simulated: false };
}

export function fmtRadar(lines: string[]): string {
  return ["Publisher Radar " + new Date().toLocaleString("pt-BR"), "", ...lines].join("\n");
}

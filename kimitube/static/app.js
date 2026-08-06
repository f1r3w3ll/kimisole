/* Kimitube — dashboard (JS vanilla + fetch + Chart.js) */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
  return data;
}

const post = (path, body = {}) => api(path, { method: "POST", body: JSON.stringify(body) });

function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast${isError ? " error" : ""}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 5000);
}

function fmtNum(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("pt-BR");
}

function fmtPct(n) {
  if (n === null || n === undefined) return '<span class="muted">—</span>';
  const cls = n >= 0 ? "pos" : "neg";
  return `<span class="${cls}">${n > 0 ? "+" : ""}${n}%</span>`;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  toast("Copiado!");
}

function copyRow(text, rows = 3) {
  return `<div class="copy-row"><pre rows="${rows}">${esc(text)}</pre>
    <button class="copy-btn" data-copy="${esc(text)}">Copiar</button></div>`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------------------
// Tabs + quota
// ---------------------------------------------------------------------------

$$(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    $$(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${btn.dataset.tab}`));
  });
});

async function loadQuota() {
  try {
    const q = await api("/api/quota");
    $("#quota").textContent = `quota hoje: ${fmtNum(q.units_used_today)} / ${fmtNum(q.daily_limit)}`;
  } catch { $("#quota").textContent = "quota: erro"; }
}

// ---------------------------------------------------------------------------
// Radar
// ---------------------------------------------------------------------------

let growthChart = null;

async function loadRadar(filters = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== "" && v != null) params.set(k, v);
  const channels = await api(`/api/radar/channels?${params}`);
  const outliers = await api("/api/radar/outliers").catch(() => []);
  const scores = Object.fromEntries(outliers.map((o) => [o.id, o.radar_score]));

  const tbody = $("#radar-table tbody");
  tbody.innerHTML = channels.length ? "" : '<tr><td colspan="9" class="muted">Nenhum canal monitorado ainda. Use a aba Spy para adicionar.</td></tr>';
  for (const ch of channels) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(ch.title)}</td>
      <td>${esc(ch.niche || "—")}</td>
      <td>${fmtNum(ch.subs)}</td>
      <td>${fmtPct(ch.growth_30d_pct)}</td>
      <td>${fmtPct(ch.growth_90d_pct)}</td>
      <td>${fmtPct(ch.growth_150d_pct)}</td>
      <td>${ch.consistency_pct ?? "—"}%</td>
      <td>${fmtNum(ch.views_per_day_30d)}</td>
      <td>${scores[ch.id] ?? "—"}</td>`;
    tr.addEventListener("click", () => showGrowth(ch));
    tbody.appendChild(tr);
  }
}

async function loadNicheInsights() {
  const shorts = await api("/api/radar/shorts-vs-long");
  const revenue = await api("/api/radar/revenue-estimate");

  const shortsBody = $("#shorts-long-table tbody");
  shortsBody.innerHTML = shorts.length ? "" : '<tr><td colspan="6" class="muted">Sem dados suficientes.</td></tr>';
  for (const row of shorts) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(row.niche)}</td>
      <td>${fmtNum(row.shorts_count)}</td>
      <td>${fmtNum(row.longs_count)}</td>
      <td>${fmtNum(row.shorts_avg_views)}</td>
      <td>${fmtNum(row.longs_avg_views)}</td>
      <td>${esc(row.dominant_format)}</td>`;
    shortsBody.appendChild(tr);
  }

  const revBody = $("#revenue-table tbody");
  revBody.innerHTML = revenue.length ? "" : '<tr><td colspan="6" class="muted">Sem dados suficientes.</td></tr>';
  for (const row of revenue) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(row.niche)}</td>
      <td>${fmtNum(row.channels)}</td>
      <td>${fmtNum(row.views_per_day)}</td>
      <td>${fmtNum(row.monthly_views_est)}</td>
      <td>US$ ${fmtNum(row.revenue_min_est)}</td>
      <td>US$ ${fmtNum(row.revenue_max_est)}</td>`;
    revBody.appendChild(tr);
  }
}

async function showGrowth(channel) {
  const snaps = await api(`/api/radar/channels/${channel.id}/snapshots`);
  if (growthChart) growthChart.destroy();
  const ctx = $("#growth-chart");
  growthChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: snaps.map((s) => s.date),
      datasets: [{
        label: `${channel.title} — inscritos`,
        data: snaps.map((s) => s.subs),
        borderColor: "#4f8cff",
        backgroundColor: "rgba(79,140,255,0.15)",
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      plugins: { legend: { labels: { color: "#e6e8ee" } } },
      scales: {
        x: { ticks: { color: "#9aa3b2" }, grid: { color: "#262b36" } },
        y: { ticks: { color: "#9aa3b2" }, grid: { color: "#262b36" } },
      },
    },
  });
}

$("#radar-filters")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const range = f.subs_range.value.split("-");
  try {
    await loadRadar({
      niche: f.niche.value.trim(),
      min_subs: range[0] || "",
      max_subs: range[1] || "",
      min_growth_30d: f.min_growth_30d.value,
      min_consistency: f.min_consistency.value,
    });
  } catch (err) { toast(err.message, true); }
});

$("#btn-collect")?.addEventListener("click", async () => {
  try {
    toast("Coletando snapshots…");
    const r = await post("/api/collect");
    toast(`Coleta: ${r.channels_collected} canais. Erros: ${r.errors.length}`);
    loadQuota();
    loadRadar();
  } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

async function loadKeywords() {
  const kws = await api("/api/radar/keywords");
  const tbody = $("#keywords-table tbody");
  tbody.innerHTML = kws.length ? "" : '<tr><td colspan="6" class="muted">Nenhuma keyword cadastrada.</td></tr>';
  for (const k of kws) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(k.term)}</td>
      <td>${esc(k.niche || "—")}</td>
      <td>${fmtNum(k.avg_views_recent)}</td>
      <td>${fmtNum(k.video_count_recent)}</td>
      <td>${k.trends_index ?? "—"}</td>
      <td>${fmtPct(k.weekly_growth_pct)}</td>`;
    tbody.appendChild(tr);
  }
}

$("#keyword-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await post("/api/keywords", { term: f.term.value.trim(), niche: f.niche.value.trim() || null });
    toast("Keyword adicionada.");
    f.reset();
    loadKeywords();
  } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

$("#compare-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = $("#compare-result");
  const raw = e.target.queries.value.trim();
  const queries = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  if (queries.length < 2) {
    toast("Informe ao menos 2 canais separados por vírgula.", true);
    return;
  }
  out.innerHTML = '<p class="spinner">Comparando concorrentes…</p>';
  try {
    const r = await post("/api/compare", { queries });
    const rows = (r.items || []).map((it) => {
      if (it.error) {
        return `<tr><td>${esc(it.query)}</td><td colspan="7" class="muted">Erro: ${esc(it.error)}</td></tr>`;
      }
      return `<tr>
        <td>${esc(it.title)}</td>
        <td>${fmtNum(it.subs)}</td>
        <td>${fmtNum(it.avg_views)}</td>
        <td>${it.engagement_pct}%</td>
        <td>${it.videos_per_week ?? "—"}</td>
        <td>${it.pct_shorts}%</td>
        <td>${fmtNum(it.views_total)}</td>
        <td>${r.leader && r.leader.id === it.id ? "🏆 líder" : ""}</td>
      </tr>`;
    }).join("");
    out.innerHTML = `<div class="table-wrap"><table><thead>
      <tr><th>Canal</th><th>Subs</th><th>Média views</th><th>Engaj.</th><th>Vídeos/semana</th><th>% Shorts</th><th>Views totais</th><th>Status</th></tr>
    </thead><tbody>${rows}</tbody></table></div>`;
  } catch (err) {
    out.innerHTML = "";
    toast(err.message, true);
  }
});

// ---------------------------------------------------------------------------
// Spy
// ---------------------------------------------------------------------------

function statCard(label, value) {
  return `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

$("#spy-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = e.target.query.value.trim();
  const out = $("#spy-result");
  out.innerHTML = '<p class="spinner">Espionando… (consome ~3-5 unidades de quota)</p>';
  try {
    const r = await post("/api/spy", { query });
    const ch = r.channel;
    out.innerHTML = `
      <h3>${esc(ch.title)} <span class="muted">${esc(ch.handle || "")}</span></h3>
      <div class="cards">
        ${statCard("Inscritos", fmtNum(ch.subs))}
        ${statCard("Views totais", fmtNum(ch.total_views))}
        ${statCard("Vídeos", fmtNum(ch.video_count))}
        ${statCard("Crescimento local", r.growth_pct_local != null ? r.growth_pct_local + "%" : "—")}
        ${statCard("Vídeos/semana", r.posting_frequency.videos_per_week ?? "—")}
        ${statCard("Melhor dia", r.best_time.best_weekday ?? "—")}
        ${statCard("Melhor hora (UTC)", r.best_time.best_hour_utc != null ? r.best_time.best_hour_utc + "h" : "—")}
        ${statCard("Média views", fmtNum(r.averages.views))}
        ${statCard("Média likes", fmtNum(r.averages.likes))}
        ${statCard("Média comments", fmtNum(r.averages.comments))}
        ${statCard("Engajamento", r.engagement_pct + "%")}
        ${statCard("Shorts / Longos", `${r.shorts_vs_long.shorts} / ${r.shorts_vs_long.longs} (${r.shorts_vs_long.pct_shorts}%)`)}
      </div>
      <div class="filters">
        <input id="track-niche" placeholder="Nicho (opcional)">
        <button id="btn-track" ${ch.tracked ? "disabled" : ""}>${ch.tracked ? "Já monitorado" : "Monitorar canal"}</button>
      </div>
      <h3>Padrões de título</h3>
      <div class="cards">
        ${statCard("Tamanho médio", r.title_patterns.avg_length ?? "—")}
        ${statCard("Com números", r.title_patterns.pct_with_numbers + "%")}
        ${statCard("Perguntas", r.title_patterns.pct_questions + "%")}
        ${statCard("Palavras em CAIXA ALTA", r.title_patterns.pct_all_caps_words + "%")}
      </div>
      <h3>Top 10 vídeos</h3>
      <div class="table-wrap"><table><thead>
        <tr><th></th><th>Título</th><th>Views</th><th>Likes</th><th>Comments</th><th>Publicado</th></tr>
      </thead><tbody>
        ${r.top_videos.map((v) => `<tr>
          <td><img class="video-thumb" src="${v.thumbnail_url || ""}" alt=""></td>
          <td>${esc(v.title)}${v.is_short ? ' <span class="tag">Short</span>' : ""}</td>
          <td>${fmtNum(v.views)}</td><td>${fmtNum(v.likes)}</td><td>${fmtNum(v.comments)}</td>
          <td class="muted">${(v.published_at || "").slice(0, 10)}</td>
        </tr>`).join("")}
      </tbody></table></div>
      <h3>Tags mais usadas</h3>
      <div class="tags">${r.top_tags.map(([t, c]) => `<span class="tag">${esc(t)} (${c})</span>`).join("")}</div>
      <h3>Outliers 24-72h</h3>
      <div class="table-wrap"><table><thead>
        <tr><th></th><th>Título</th><th>Views</th><th>Idade (h)</th><th>Multiplicador</th><th>Formato</th></tr>
      </thead><tbody>
        ${(r.video_outliers_24_72h || []).length ? r.video_outliers_24_72h.map((v) => `<tr>
          <td><img class="video-thumb" src="${v.thumbnail_url || ""}" alt=""></td>
          <td>${esc(v.title)}</td>
          <td>${fmtNum(v.views)}</td>
          <td>${fmtNum(v.age_hours)}</td>
          <td>${v.multiplier}x</td>
          <td>${v.is_short ? "Short" : "Long"}</td>
        </tr>`).join("") : `<tr><td colspan="6" class="muted">Sem outliers entre 24h e 72h.</td></tr>`}
      </tbody></table></div>`;

    $("#btn-track")?.addEventListener("click", async () => {
      try {
        await post("/api/channels/track", {
          channel_id: ch.id,
          niche: $("#track-niche").value.trim() || null,
        });
        toast("Canal adicionado ao radar.");
        $("#btn-track").textContent = "Já monitorado";
        $("#btn-track").disabled = true;
      } catch (err) { toast(err.message, true); }
    });
    loadQuota();
  } catch (err) {
    out.innerHTML = "";
    toast(err.message, true);
  }
});

// ---------------------------------------------------------------------------
// Descoberta
// ---------------------------------------------------------------------------

function renderDiscoverResult(data) {
  const out = $("#discover-result");
  if (!data.candidates || data.candidates.length === 0) {
    out.innerHTML = `<p class="muted">Nenhum candidato encontrado. Tente outro seed ou relaxe os filtros.</p>`;
    return;
  }
  const list = data.candidates.map((c) => `
    <tr data-id="${esc(c.channel.id)}">
      <td><img class="video-thumb" src="${c.channel.thumbnail_url || ""}" alt=""> ${esc(c.channel.title)}</td>
      <td>${esc(c.channel.niche || "—")}</td>
      <td>${fmtNum(c.channel.subs)}</td>
      <td><strong>${c.score}</strong></td>
      <td>${esc(c.reason)}</td>
      <td>${esc(data.seed_title || data.seed_keyword || "—")}</td>
      <td><button class="btn-track-candidate" data-id="${esc(c.channel.id)}">Monitorar</button></td>
    </tr>
  `).join("");
  out.innerHTML = `
    <p class="muted">${data.candidates.length} candidato(s) encontrado(s). Seed: <code>${esc(data.seed_channel_id || data.seed_keyword)}</code>. Termos usados: ${(data.terms_used || []).map(esc).join(", ") || "—"}.</p>
    <div class="table-wrap"><table><thead>
      <tr><th>Canal</th><th>Nicho</th><th>Inscritos</th><th>Score</th><th>Motivo</th><th>Seed</th><th>Ação</th></tr>
    </thead><tbody>${list}</tbody></table></div>`;
}

$("#discover-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const out = $("#discover-result");
  out.innerHTML = '<p class="spinner">Buscando canais similares… (pode consumir 100-300 unidades de quota)</p>';
  try {
    const r = await post("/api/discover", {
      seed: f.seed.value.trim(),
      strategy: f.strategy.value,
      max_results: parseInt(f.max_results.value, 10) || 25,
      min_subs: f.min_subs.value ? parseInt(f.min_subs.value, 10) : null,
      max_subs: f.max_subs.value ? parseInt(f.max_subs.value, 10) : null,
      min_score: f.min_score.value ? parseFloat(f.min_score.value) : 0,
    });
    renderDiscoverResult(r);
    loadDiscoverCandidates();
    loadQuota();
  } catch (err) {
    out.innerHTML = "";
    toast(err.message, true);
  }
});

$("#btn-discover-auto")?.addEventListener("click", async () => {
  const out = $("#discover-result");
  out.innerHTML = '<p class="spinner">Executando descoberta automática…</p>';
  try {
    const r = await post("/api/discover/auto", { max_per_seed: 10, include_tracked: true, include_keywords: true });
    out.innerHTML = `<p class="muted">Descoberta automática concluída. Processados: ${r.processed}. Falhas: ${r.failed}.</p>`;
    loadDiscoverCandidates();
    loadQuota();
  } catch (err) {
    out.innerHTML = "";
    toast(err.message, true);
  }
});

async function loadDiscoverCandidates() {
  const params = new URLSearchParams();
  if ($("#discover-filter-tracked").checked) params.set("tracked", "0");
  const seed = $("#discover-filter-seed").value.trim();
  if (seed) {
    if (seed.startsWith("UC")) params.set("seed_channel_id", seed);
    else params.set("seed_keyword", seed);
  }
  const rows = await api(`/api/discover/candidates?${params}`);
  const tbody = $("#discover-table tbody");
  tbody.innerHTML = rows.length ? "" : '<tr><td colspan="7" class="muted">Nenhum candidato salvo ainda.</td></tr>';
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><img class="video-thumb" src="${r.thumbnail_url || ""}" alt=""> ${esc(r.title)}</td>
      <td>${esc(r.niche || "—")}</td>
      <td>${fmtNum(r.subs)}</td>
      <td><strong>${r.score}</strong></td>
      <td>${esc(r.reason)}</td>
      <td>${esc(r.seed_channel_id || r.seed_keyword || "—")}</td>
      <td>${r.tracked ? "<span class=\"muted\">Monitorado</span>" : `<button class="btn-track-candidate" data-id="${esc(r.channel_id)}">Monitorar</button>`}</td>`;
    tbody.appendChild(tr);
  }
}

$("#discover-filter-tracked")?.addEventListener("change", loadDiscoverCandidates);
$("#discover-filter-seed")?.addEventListener("input", debounce(loadDiscoverCandidates, 300));

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-track-candidate");
  if (!btn) return;
  const channelId = btn.dataset.id;
  try {
    await post(`/api/discover/candidates/${channelId}/track`);
    toast("Canal adicionado ao radar.");
    btn.replaceWith("<span class=\"muted\">Monitorado</span>");
    loadRadar();
  } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------------------
// Ferramentas: configuração + metadados + alertas
// ---------------------------------------------------------------------------

async function loadSettings() {
  try {
    const s = await api("/api/settings");
    const out = $("#apikey-status");
    if (s.youtube_api_key.configured) {
      out.innerHTML = `<p class="muted">Chave configurada: <code>${esc(s.youtube_api_key.masked_key)}</code> (${s.youtube_api_key.length} caracteres)</p>`;
    } else {
      out.innerHTML = `<p class="muted">Nenhuma chave configurada. Spy, Radar e Descoberta não funcionarão.</p>`;
    }
  } catch (err) { toast(err.message, true); }
}

$("#apikey-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const key = f.key.value.trim();
  try {
    const r = await post("/api/settings/api-key", { key });
    toast("Chave salva com sucesso.");
    f.reset();
    $("#apikey-status").innerHTML = `<p class="muted">Chave configurada: <code>${esc(r.status.masked_key)}</code> (${r.status.length} caracteres)</p>`;
  } catch (err) { toast(err.message, true); }
});

$("#metadata-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = e.target.query.value.trim();
  const out = $("#metadata-result");
  out.innerHTML = '<p class="spinner">Gerando metadados com IA…</p>';
  try {
    const r = await post("/api/metadata", { query });
    out.innerHTML = `
      <h3>${esc(r.original_title)} <span class="muted">— ${esc(r.channel_title)}</span></h3>
      <img class="thumb-preview" src="${r.thumbnail_url_local}" alt="capa">
      <h3>Prompt de capa (IA)</h3>
      ${copyRow(r.prompt_capa, 4)}
      <h3>5 títulos alternativos</h3>
      ${r.titulos_alternativos.map((t) => copyRow(t, 1)).join("")}
      <h3>Descrição pronta</h3>
      ${copyRow(r.descricao_pronta, 8)}
      <h3>Tags</h3>
      ${copyRow(r.tags.join(", "), 2)}`;
    loadQuota();
  } catch (err) {
    out.innerHTML = "";
    toast(err.message, true);
  }
});

async function loadAlerts() {
  const alerts = await api("/api/alerts");
  const tbody = $("#alerts-table tbody");
  tbody.innerHTML = alerts.length ? "" : '<tr><td colspan="4" class="muted">Nenhum alerta ainda.</td></tr>';
  for (const a of alerts) {
    const link = `https://www.youtube.com/watch?v=${a.video_id}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="muted">${(a.sent_at || "").slice(0, 16).replace("T", " ")}</td>
      <td>${esc(a.channel_title || a.channel_id)}</td>
      <td>${esc(a.video_title || a.video_id)}</td>
      <td><a href="${link}" target="_blank" rel="noopener">abrir</a></td>`;
    tbody.appendChild(tr);
  }
}

$("#btn-alerts-check")?.addEventListener("click", async () => {
  const out = $("#alerts-check-result");
  out.innerHTML = '<p class="spinner">Verificando RSS…</p>';
  try {
    const r = await post("/api/alerts/check");
    out.innerHTML = `<p class="muted">${r.channels_checked} canais verificados — ${r.new_videos.length} vídeo(s) novo(s), ${r.emails_sent} e-mail(s) enviado(s)${r.smtp_configured ? "" : " (SMTP não configurado: apenas registrado)"}.</p>`;
    loadAlerts();
  } catch (err) {
    out.innerHTML = "";
    toast(err.message, true);
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy]");
  if (btn) copyText(btn.dataset.copy);
});

loadQuota();
loadRadar().catch((err) => toast(err.message, true));
loadNicheInsights().catch((err) => toast(err.message, true));
loadKeywords().catch((err) => toast(err.message, true));
loadAlerts().catch((err) => toast(err.message, true));
loadDiscoverCandidates().catch((err) => toast(err.message, true));
loadSettings().catch((err) => toast(err.message, true));

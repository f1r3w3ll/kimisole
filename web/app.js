/* kimiSole — frontend com persistencia de sessoes */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const chatEl = $("#chat");
const inputEl = $("#input");
const sendBtn = $("#send");
const statusBar = $("#status-bar");
const statusText = $("#status-text");
const rootsList = $("#roots-list");
const sessionsList = $("#sessions-list");
const statsEl = $("#stats");
const toastEl = $("#toast");

const LS_KEY = "kimi_session_id";
let busy = false;
let currentSessionId = localStorage.getItem(LS_KEY);
let currentTitle = null;

marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang }).value; } catch (_) {}
    }
    return code;
  },
});

/* ---------------- util ---------------- */
function generateId() {
  return "web-" + Math.random().toString(36).slice(2, 10);
}

function scrollBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function removeWelcome() {
  const w = $("#welcome");
  if (w) w.remove();
}

function setStatus(text) {
  if (text) {
    statusBar.classList.remove("hidden");
    statusText.textContent = text;
  } else {
    statusBar.classList.add("hidden");
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function argsPreview(args) {
  try {
    const s = Object.entries(args)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(", ");
    return s.length > 120 ? s.slice(0, 120) + "…" : s;
  } catch (_) {
    return "";
  }
}

function showToast(message, type = "info") {
  toastEl.textContent = message;
  toastEl.className = type;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 3200);
}

function setSession(sessionId, title) {
  currentSessionId = sessionId;
  currentTitle = title || null;
  localStorage.setItem(LS_KEY, sessionId);
  updateActiveSessionItem();
  if (title) document.title = title + " · kimiSole";
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function autoApproveEnabled() {
  return $("#auto-approve").checked;
}

/* ---------------- sessoes ---------------- */
async function loadSessions() {
  try {
    const resp = await fetch("/api/sessions");
    const data = await resp.json();
    renderSessions(data.sessions || []);
  } catch (err) {
    console.error("Erro ao carregar sessoes:", err);
  }
}

function renderSessions(sessions) {
  sessionsList.innerHTML = "";
  if (!sessions.length) {
    sessionsList.innerHTML = `<div class="empty-sessions">Nenhuma conversa ainda</div>`;
    updateActiveSessionItem();
    return;
  }
  for (const s of sessions) {
    const item = document.createElement("div");
    item.className = "session-item";
    item.dataset.id = s.id;
    if (s.id === currentSessionId) item.classList.add("active");

    const title = document.createElement("span");
    title.className = "session-title";
    title.textContent = s.title;
    title.title = s.title;
    title.addEventListener("click", () => switchSession(s.id));

    const meta = document.createElement("span");
    meta.className = "session-meta";
    meta.textContent = formatDateTime(s.updated_at);
    meta.title = s.updated_at || "";

    const menu = document.createElement("div");
    menu.className = "session-menu";
    menu.innerHTML = `
      <button title="Renomear">✎</button>
      <button title="Exportar">⬇</button>
      <button title="Apagar">🗑</button>
    `;
    const [btnRename, btnExport, btnDelete] = menu.querySelectorAll("button");
    btnRename.addEventListener("click", (e) => { e.stopPropagation(); startInlineRename(item, s.id, s.title); });
    btnExport.addEventListener("click", (e) => { e.stopPropagation(); exportSession(s.id); });
    btnDelete.addEventListener("click", (e) => { e.stopPropagation(); deleteSessionPrompt(s.id); });

    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(menu);
    sessionsList.appendChild(item);
  }
  updateActiveSessionItem();
}

function updateActiveSessionItem() {
  $$(".session-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === currentSessionId);
  });
}

async function createSession(title = "Nova conversa") {
  try {
    const resp = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await resp.json();
    setSession(data.id, data.title);
    chatEl.innerHTML = welcomeHtml();
    inputEl.value = "";
    autoResize();
    loadSessions();
    inputEl.focus();
    return data.id;
  } catch (err) {
    showToast("Erro ao criar sessao", "error");
    throw err;
  }
}

async function switchSession(sessionId) {
  if (busy) {
    showToast("Aguarde a resposta atual terminar", "error");
    return;
  }
  try {
    const resp = await fetch("/api/sessions/" + encodeURIComponent(sessionId));
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    setSession(sessionId, data.title);
    renderSessionMessages(data.messages);
    loadSessions();
  } catch (err) {
    showToast("Erro ao carregar sessao", "error");
  }
}

function renderSessionMessages(messages) {
  chatEl.innerHTML = "";
  const nonSystem = messages.filter((m) => m.role !== "system");
  if (!nonSystem.length) {
    chatEl.innerHTML = welcomeHtml();
    return;
  }

  const chips = {};
  for (const msg of nonSystem) {
    try {
      if (msg.role === "user") {
        addUserMessage(msg.content);
      } else if (msg.role === "assistant") {
        const body = addAssistantMessage();
        renderMarkdown(body, msg.content || "");
        for (const tc of msg.tool_calls || []) {
          const fn = tc.function || {};
          let args = {};
          try {
            args = JSON.parse(fn.arguments || "{}");
          } catch (_) {
            args = { raw: fn.arguments };
          }
          const chip = addToolChip(fn.name, args);
          chips[tc.id] = chip;
        }
      } else if (msg.role === "tool") {
        const chip = chips[msg.tool_call_id];
        if (chip) {
          chip.classList.add("ok");
          chip.querySelector(".tool-chip-body").textContent = msg.content;
        }
      }
    } catch (err) {
      console.error("Erro ao renderizar mensagem:", msg, err);
    }
  }
  scrollBottom();
}

function startInlineRename(item, sessionId, current) {
  const titleEl = item.querySelector(".session-title");
  const metaEl = item.querySelector(".session-meta");
  const menuEl = item.querySelector(".session-menu");
  if (!titleEl) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = current;

  const save = async () => {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== current) {
      try {
        await fetch("/api/sessions/" + encodeURIComponent(sessionId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        });
        if (sessionId === currentSessionId) currentTitle = newTitle;
      } catch (err) {
        showToast("Erro ao renomear", "error");
      }
    }
    loadSessions();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") { loadSessions(); }
  });
  input.addEventListener("blur", save);

  titleEl.replaceWith(input);
  if (metaEl) metaEl.style.display = "none";
  if (menuEl) menuEl.style.display = "none";
  input.focus();
  input.select();
}

async function deleteSessionPrompt(sessionId) {
  if (!confirm("Apagar esta conversa permanentemente?")) return;
  try {
    await fetch("/api/sessions/" + encodeURIComponent(sessionId), { method: "DELETE" });
    if (sessionId === currentSessionId) {
      localStorage.removeItem(LS_KEY);
      currentSessionId = null;
      currentTitle = null;
      chatEl.innerHTML = welcomeHtml();
    }
    loadSessions();
  } catch (err) {
    showToast("Erro ao apagar", "error");
  }
}

async function exportSession(sessionId) {
  try {
    const resp = await fetch("/api/sessions/" + encodeURIComponent(sessionId) + "/export", { method: "POST" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const cd = resp.headers.get("content-disposition");
    const filename = cd ? cd.split("filename=")[1]?.replace(/"/g, "") : "conversa.md";
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Exportado com sucesso");
  } catch (err) {
    showToast("Erro ao exportar", "error");
  }
}

function welcomeHtml() {
  return `
    <div id="welcome">
      <div class="welcome-logo">✳</div>
      <h1>Kimi Code</h1>
      <p>Agente de programação com o modelo <code>kimi-k2.7-code</code>.</p>
      <p class="hint">Marque pastas na barra lateral e peça análises, edições, buscas na web, comandos git e mais.</p>
      <div class="suggestions">
        <button class="suggestion">Analise o código deste projeto e sugira melhorias</button>
        <button class="suggestion">Explique a estrutura das pastas marcadas</button>
        <button class="suggestion">Busque na web as novidades do FastAPI</button>
      </div>
    </div>`;
}

/* ---------------- mensagens ---------------- */
function addUserMessage(text) {
  removeWelcome();
  const div = document.createElement("div");
  div.className = "msg user";
  div.innerHTML = `<div class="msg-role">VOCÊ</div><div class="msg-body"></div>`;
  div.querySelector(".msg-body").textContent = text;
  chatEl.appendChild(div);
  scrollBottom();
}

function addAssistantMessage() {
  removeWelcome();
  const div = document.createElement("div");
  div.className = "msg assistant";
  div.innerHTML = `<div class="msg-role">✳ KIMI</div><div class="msg-body"></div>`;
  chatEl.appendChild(div);
  scrollBottom();
  return div.querySelector(".msg-body");
}

function renderMarkdown(el, raw) {
  el.innerHTML = marked.parse(raw);
  el.querySelectorAll("pre code").forEach((b) => {
    try { hljs.highlightElement(b); } catch (_) {}
  });
}

function addToolChip(name, args) {
  const wrap = document.createElement("div");
  wrap.className = "tool-chip";
  wrap.innerHTML = `
    <div class="tool-chip-inner">
      <div class="tool-chip-header">
        <span class="tool-dot"></span>
        <span class="tool-name">${escapeHtml(name)}</span>
        <span class="tool-args">${escapeHtml(argsPreview(args))}</span>
        <span class="caret">▼</span>
      </div>
      <div class="tool-chip-body hidden"></div>
    </div>`;
  wrap.querySelector(".tool-chip-header").addEventListener("click", () => {
    wrap.querySelector(".tool-chip-body").classList.toggle("hidden");
  });
  chatEl.appendChild(wrap);
  scrollBottom();
  return wrap;
}

function addConfirmCard(confirmId, name, args) {
  const wrap = document.createElement("div");
  wrap.className = "confirm-card";
  wrap.innerHTML = `
    <div class="confirm-card-inner">
      <div class="confirm-title">⚠ Aprovação necessária: ${escapeHtml(name)}</div>
      <div class="confirm-detail">${escapeHtml(JSON.stringify(args, null, 2))}</div>
      <div class="confirm-actions">
        <button class="btn-approve">✓ Aprovar</button>
        <button class="btn-deny">✕ Rejeitar</button>
      </div>
    </div>`;

  const decide = async (approved) => {
    wrap.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_id: confirmId, approved }),
      });
    } catch (_) {}
    wrap.remove();
  };

  wrap.querySelector(".btn-approve").addEventListener("click", () => decide(true));
  wrap.querySelector(".btn-deny").addEventListener("click", () => decide(false));
  chatEl.appendChild(wrap);
  scrollBottom();
}

function addError(message) {
  const div = document.createElement("div");
  div.className = "error-box";
  div.innerHTML = `<div class="error-box-inner"></div>`;
  div.querySelector(".error-box-inner").textContent = "Erro: " + message;
  chatEl.appendChild(div);
  scrollBottom();
}

/* ---------------- envio / SSE ---------------- */
async function ensureSession() {
  if (currentSessionId) {
    // verifica se ainda existe
    try {
      const resp = await fetch("/api/sessions/" + encodeURIComponent(currentSessionId));
      if (resp.ok) {
        const data = await resp.json();
        currentTitle = data.title;
        return currentSessionId;
      }
    } catch (_) {}
  }
  return createSession("Nova conversa");
}

async function sendMessage(text) {
  if (busy || !text.trim()) return;
  busy = true;
  sendBtn.disabled = true;
  setStatus("Pensando…");

  await ensureSession();
  addUserMessage(text);
  inputEl.value = "";
  autoResize();
  loadSessions();

  let assistantBody = null;
  let assistantRaw = "";
  const chips = {};

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 120000);

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: currentSessionId, message: text }),
      signal: controller.signal,
    });
    clearTimeout(fetchTimeout);
    if (!resp.ok || !resp.body) throw new Error("HTTP " + resp.status);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (!frame.startsWith("data:")) continue;

        let ev;
        try { ev = JSON.parse(frame.slice(5)); } catch (_) { continue; }

        switch (ev.type) {
          case "text_delta":
            if (!assistantBody) assistantBody = addAssistantMessage();
            assistantRaw += ev.text;
            renderMarkdown(assistantBody, assistantRaw);
            scrollBottom();
            setStatus(null);
            break;

          case "tool_call": {
            setStatus(`Usando ferramenta: ${ev.name}…`);
            chips[ev.id] = addToolChip(ev.name, ev.args);
            assistantBody = null;
            assistantRaw = "";
            break;
          }

          case "tool_confirm":
            if (autoApproveEnabled()) {
              setStatus(`Autoaprovando ${ev.name}…`);
              fetch("/api/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirm_id: ev.id, approved: true }),
              }).catch((err) => console.error("Erro ao autoaprovar:", err));
            } else {
              setStatus("Aguardando sua aprovação…");
              addConfirmCard(ev.id, ev.name, ev.args);
            }
            break;

          case "tool_result": {
            const chip = chips[ev.id];
            if (chip) {
              chip.classList.add("ok");
              chip.querySelector(".tool-chip-body").textContent = ev.result;
            }
            setStatus("Pensando…");
            break;
          }

          case "tool_denied": {
            const chip = chips[ev.id];
            if (chip) {
              chip.classList.add("denied");
              chip.querySelector(".tool-chip-body").textContent = "(rejeitada pelo usuário)";
            }
            setStatus("Pensando…");
            break;
          }

          case "error":
            addError(ev.message);
            break;

          case "done":
            loadSessions();
            break;
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      addError("A resposta demorou mais que o esperado. Tente enviar novamente.");
    } else {
      addError(err.message || String(err));
    }
  } finally {
    clearTimeout(fetchTimeout);
    busy = false;
    sendBtn.disabled = false;
    setStatus(null);
    inputEl.focus();
  }
}

/* ---------------- pastas / arvore ---------------- */
async function loadRoots() {
  try {
    console.log("[loadRoots] fetching...");
    const resp = await fetch("/api/roots");
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    console.log("[loadRoots] data:", data);
    rootsList.innerHTML = "";
    for (const root of data.roots || []) {
      rootsList.appendChild(await buildRootBlock(root));
    }
    console.log("[loadRoots] rendered", data.roots.length, "roots");
  } catch (err) {
    console.error("[loadRoots] Erro ao carregar pastas:", err);
    showToast("Erro ao carregar pastas marcadas", "error");
  }
}

async function buildRootBlock(root) {
  const block = document.createElement("div");
  block.className = "root-block";

  const name = root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root;
  const header = document.createElement("div");
  header.className = "root-header";
  header.innerHTML = `
    <span class="caret">▶</span>
    <span class="root-name" title="${escapeHtml(root)}">📁 ${escapeHtml(name)}</span>
    <button class="root-remove" title="Remover pasta">✕</button>`;

  const treeEl = document.createElement("div");
  treeEl.className = "tree hidden";
  let loaded = false;

  header.addEventListener("click", async (e) => {
    if (e.target.classList.contains("root-remove")) return;
    const caret = header.querySelector(".caret");
    if (treeEl.classList.contains("hidden")) {
      if (!loaded) {
        const resp = await fetch("/api/tree?root=" + encodeURIComponent(root));
        if (resp.ok) {
          const data = await resp.json();
          renderTree(treeEl, data.tree);
          loaded = true;
        }
      }
      treeEl.classList.remove("hidden");
      caret.textContent = "▼";
    } else {
      treeEl.classList.add("hidden");
      caret.textContent = "▶";
    }
  });

  header.querySelector(".root-remove").addEventListener("click", async () => {
    await fetch("/api/roots", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    loadRoots();
  });

  block.appendChild(header);
  block.appendChild(treeEl);
  return block;
}

function renderTree(container, nodes) {
  for (const node of nodes) {
    if (node.type === "dir") {
      const dirEl = document.createElement("div");
      dirEl.className = "tree-node";
      dirEl.innerHTML = `<span class="icon">▶</span><span>📁 ${escapeHtml(node.name)}</span>`;
      const childWrap = document.createElement("div");
      childWrap.className = "tree hidden";
      renderTree(childWrap, node.children || []);
      dirEl.addEventListener("click", () => {
        childWrap.classList.toggle("hidden");
        dirEl.querySelector(".icon").textContent = childWrap.classList.contains("hidden") ? "▶" : "▼";
      });
      container.appendChild(dirEl);
      container.appendChild(childWrap);
    } else {
      const fileEl = document.createElement("div");
      fileEl.className = "tree-node";
      fileEl.title = "Clique para citar no prompt";
      fileEl.innerHTML = `<span class="icon">📄</span><span>${escapeHtml(node.name)}</span>`;
      fileEl.addEventListener("click", () => {
        inputEl.value = (inputEl.value + " " + node.path).trim() + " ";
        inputEl.focus();
        autoResize();
      });
      container.appendChild(fileEl);
    }
  }
}

/* ---------------- add root form ---------------- */
function openAddRootForm() {
  $("#add-root-form").classList.remove("hidden");
  $("#root-input").focus();
}

function closeAddRootForm() {
  $("#add-root-form").classList.add("hidden");
  $("#root-input").value = "";
}

$("#btn-add-root").addEventListener("click", openAddRootForm);
$("#root-cancel").addEventListener("click", closeAddRootForm);
$("#root-confirm").addEventListener("click", addRootFromInput);
$("#root-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addRootFromInput();
  }
  if (e.key === "Escape") {
    closeAddRootForm();
  }
});

function normalizePathInput(raw) {
  // No Windows o usuario digita d:\pasta\subpasta. O JSON escapa a barra,
  // entao normalizamos para d:/pasta/subpasta antes de enviar.
  return raw.trim().replace(/\\/g, "/");
}

async function addRootFromInput() {
  const path = normalizePathInput($("#root-input").value);
  console.log("[addRootFromInput] path:", path);
  if (!path) {
    showToast("Digite o caminho da pasta", "error");
    return;
  }
  const btn = $("#root-confirm");
  btn.disabled = true;
  try {
    const resp = await fetch("/api/roots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    console.log("[addRootFromInput] resp status:", resp.status);
    if (resp.ok) {
      const data = await resp.json();
      console.log("[addRootFromInput] resp data:", data);
      closeAddRootForm();
      await loadRoots();
      showToast("Pasta adicionada");
    } else {
      const data = await resp.json().catch(() => ({}));
      console.error("[addRootFromInput] erro:", data);
      showToast(data.detail || "Não foi possível adicionar a pasta.", "error");
    }
  } catch (err) {
    console.error("[addRootFromInput] exception:", err);
    showToast("Erro de conexão ao adicionar pasta", "error");
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- nova conversa / reset ---------------- */
$("#btn-new-chat").addEventListener("click", () => createSession("Nova conversa"));
$("#btn-reset").addEventListener("click", async () => {
  if (currentSessionId) {
    await fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: currentSessionId }),
    });
    localStorage.removeItem(LS_KEY);
    currentSessionId = null;
    currentTitle = null;
  }
  chatEl.innerHTML = welcomeHtml();
  loadSessions();
  inputEl.focus();
});

/* ---------------- input ---------------- */
function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + "px";
}

inputEl.addEventListener("input", autoResize);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(inputEl.value);
  }
});
sendBtn.addEventListener("click", () => sendMessage(inputEl.value));

document.querySelectorAll(".suggestion").forEach((btn) => {
  btn.addEventListener("click", () => sendMessage(btn.textContent));
});

/* ---------------- estatisticas ---------------- */
async function loadStats() {
  try {
    const resp = await fetch("/api/stats");
    const data = await resp.json();
    statsEl.textContent = `${data.sessions} conversa(s) · ${data.total_messages} mensagens`;
  } catch (_) {}
}

/* ---------------- monitor de andamento ---------------- */
const monitorStatus = $("#monitor-status");
const monitorTimer = $("#monitor-timer");
const monitorPending = $("#monitor-pending");
const monitorEvents = $("#monitor-events");
const statusDot = $("#status-dot");
let monitorLastEventTs = null;
let monitorBusySince = null;
let monitorOnline = true;

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function formatEvent(ev) {
  const ts = new Date(ev.ts).toLocaleTimeString("pt-BR", { hour12: false });
  const type = ev.event;
  const detail = ev.detail || {};
  switch (type) {
    case "chat.start":
      return `<div class="monitor-event chat-start"><span class="ev-ts">[${ts}]</span> 📝 iniciou resposta</div>`;
    case "chat.done":
      return `<div class="monitor-event chat-done"><span class="ev-ts">[${ts}]</span> ✅ resposta pronta (${detail.turns || 1} turno)</div>`;
    case "chat.error":
      return `<div class="monitor-event chat-error"><span class="ev-ts">[${ts}]</span> ❌ erro: ${escapeHtml(detail.error || "")}</div>`;
    case "chat.limit":
      return `<div class="monitor-event chat-limit"><span class="ev-ts">[${ts}]</span> ⚠️ limite de turnos</div>`;
    case "tool.call": {
      const cmd = detail.args && detail.args.command ? detail.args.command : argsPreview(detail.args || {});
      const label = detail.name === "run_command" ? "🖥" : "🔧";
      return `<div class="monitor-event tool-call" title="${escapeHtml(cmd)}"><span class="ev-ts">[${ts}]</span> ${label} ${escapeHtml(detail.name || "")}: ${escapeHtml(cmd.length > 70 ? cmd.slice(0, 70) + "…" : cmd)}</div>`;
    }
    case "tool.confirm": {
      const cmd = detail.args && detail.args.command ? detail.args.command : argsPreview(detail.args || {});
      return `<div class="monitor-event tool-confirm" title="${escapeHtml(cmd)}"><span class="ev-ts">[${ts}]</span> ⏸ aguardando: ${escapeHtml(detail.name || "")} — ${escapeHtml(cmd.length > 50 ? cmd.slice(0, 50) + "…" : cmd)}</div>`;
    }
    case "tool.result": {
      const preview = detail.result_preview || "";
      const ok = preview.startsWith("Erro:") || preview.startsWith("[timeout:") ? "❌" : "✅";
      return `<div class="monitor-event tool-result" title="${escapeHtml(preview)}"><span class="ev-ts">[${ts}]</span> ${ok} ${escapeHtml(detail.name || "")}: ${escapeHtml(preview.length > 70 ? preview.slice(0, 70) + "…" : preview)}</div>`;
    }
    case "tool.denied":
      return `<div class="monitor-event tool-denied"><span class="ev-ts">[${ts}]</span> 🚫 rejeitado: ${escapeHtml(detail.name || "")}</div>`;
    default:
      return `<div class="monitor-event"><span class="ev-ts">[${ts}]</span> ${escapeHtml(type)}</div>`;
  }
}

async function updateMonitor() {
  try {
    const reqs = [fetch("/api/events?limit=40")];
    if (currentSessionId) {
      reqs.push(fetch("/api/status/" + encodeURIComponent(currentSessionId)));
    }
    const [eventsResp, statusResp] = await Promise.all(reqs);
    if (!eventsResp.ok || (statusResp && !statusResp.ok)) throw new Error("HTTP " + eventsResp.status);

    monitorOnline = true;
    const eventsData = await eventsResp.json();
    const status = statusResp ? await statusResp.json() : { busy: false, pending_confirmations: [] };

    if (!currentSessionId) {
      statusDot.className = "status-dot idle";
      monitorStatus.textContent = "Nenhuma sessão ativa";
      monitorTimer.textContent = "";
    } else if (status.busy) {
      statusDot.className = "status-dot busy";
      monitorStatus.textContent = "Processando...";
      if (!monitorBusySince) monitorBusySince = Date.now();
      monitorTimer.textContent = "Tempo: " + formatDuration(Date.now() - monitorBusySince);
    } else {
      statusDot.className = "status-dot idle";
      monitorStatus.textContent = "Sessão ociosa";
      monitorTimer.textContent = "";
      monitorBusySince = null;
    }

    if (status.pending_confirmations && status.pending_confirmations.length) {
      monitorPending.innerHTML = status.pending_confirmations
        .map((p) => `<div class="monitor-pending-item">⏸ ${escapeHtml(p.name)}: ${escapeHtml(argsPreview(p.args))}</div>`)
        .join("");
    } else {
      monitorPending.innerHTML = "";
    }

    const events = eventsData.events || [];
    if (events.length) {
      monitorLastEventTs = events[0].ts;
      const relevant = events.filter((e) =>
        ["chat.start", "chat.done", "chat.error", "chat.limit", "tool.call", "tool.confirm", "tool.result", "tool.denied"].includes(e.event)
      );
      monitorEvents.innerHTML = relevant
        .slice(0, 25)
        .map((e) => formatEvent(e))
        .join("");
    } else {
      monitorEvents.innerHTML = `<div class="monitor-event" style="color:var(--text-faint)">Nenhum evento ainda</div>`;
    }
  } catch (err) {
    if (monitorOnline) {
      monitorOnline = false;
      statusDot.className = "status-dot offline";
      monitorStatus.textContent = "Servidor offline";
      monitorTimer.textContent = "Recarregue a página ou reinicie o servidor";
      monitorPending.innerHTML = "";
    }
    console.error("Erro no monitor:", err);
  }
}

function startMonitor() {
  updateMonitor();
  setInterval(updateMonitor, 2000);
}

/* ---------------- init ---------------- */
async function init() {
  loadRoots();
  loadSessions();
  loadStats();
  startMonitor();

  if (currentSessionId) {
    try {
      const resp = await fetch("/api/sessions/" + encodeURIComponent(currentSessionId));
      if (resp.ok) {
        const data = await resp.json();
        setSession(currentSessionId, data.title);
        renderSessionMessages(data.messages);
      } else {
        await createSession("Nova conversa");
      }
    } catch (err) {
      chatEl.innerHTML = welcomeHtml();
    }
  } else {
    chatEl.innerHTML = welcomeHtml();
  }

  inputEl.focus();
}

init();

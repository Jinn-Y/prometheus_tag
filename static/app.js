const rowsEl = document.querySelector("#targetRows");
const summaryEl = document.querySelector("#summary");
const statusEl = document.querySelector("#status");
const searchInput = document.querySelector("#searchInput");
const editor = document.querySelector("#editor");
const form = document.querySelector("#targetForm");
const editorTitle = document.querySelector("#editorTitle");
const targetsInput = document.querySelector("#targetsInput");
const labelRows = document.querySelector("#labelRows");
const deleteBtn = document.querySelector("#deleteBtn");
const confirmDialog = document.querySelector("#confirmDialog");
const confirmTitle = document.querySelector("#confirmTitle");
const confirmMessage = document.querySelector("#confirmMessage");
const confirmOkBtn = document.querySelector("#confirmOkBtn");
const backupDialog = document.querySelector("#backupDialog");
const backupListBtn = document.querySelector("#backupListBtn");
const backupCloseBtn = document.querySelector("#backupCloseBtn");
const backupRows = document.querySelector("#backupRows");
const backupSummary = document.querySelector("#backupSummary");
const backupName = document.querySelector("#backupName");
const backupMeta = document.querySelector("#backupMeta");
const backupContent = document.querySelector("#backupContent");
const restoreBackupBtn = document.querySelector("#restoreBackupBtn");

let targets = [];
let editingIndex = null;
let backups = [];
let selectedBackup = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#b42318" : "#667085";
}

function showConfirm(title, message) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmDialog.showModal();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function labelValue(item, key) {
  return item.labels?.[key] || "";
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function renderBackups() {
  backupSummary.textContent = backups.length ? `共 ${backups.length} 个备份` : "暂无备份";
  backupRows.innerHTML = backups.length
    ? backups.map((backup) => `
        <button type="button" class="backup-item ${selectedBackup?.name === backup.name ? "active" : ""}" data-backup="${escapeHtml(backup.name)}">
          ${escapeHtml(backup.name)}
          <span>${escapeHtml(backup.modified)} · ${formatBytes(backup.size)}</span>
        </button>
      `).join("")
    : `<div class="empty-state">暂无备份记录</div>`;
}

async function loadBackups() {
  const data = await api("/api/backups");
  backups = data.backups;
  selectedBackup = null;
  backupName.textContent = "请选择备份";
  backupMeta.textContent = "";
  backupContent.textContent = "选择左侧备份后查看 JSON 内容。";
  restoreBackupBtn.disabled = true;
  renderBackups();
}

async function selectBackup(name) {
  const data = await api(`/api/backups/${encodeURIComponent(name)}`);
  selectedBackup = data.backup;
  backupName.textContent = data.backup.name;
  backupMeta.textContent = `${data.backup.modified} · ${formatBytes(data.backup.size)}`;
  backupContent.textContent = data.content;
  restoreBackupBtn.disabled = false;
  renderBackups();
}

function render() {
  const keyword = searchInput.value.trim().toLowerCase();
  const visible = targets
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => JSON.stringify(item).toLowerCase().includes(keyword));

  summaryEl.textContent = `当前 ${targets.length} 台服务器，显示 ${visible.length} 台`;
  rowsEl.innerHTML = visible.map(({ item, index }) => {
    const labels = Object.entries(item.labels || {});
    const extraLabels = labels.filter(([key]) => !["instance", "job", "ip", "price"].includes(key));
    const targetHtml = item.targets.map((target) => `<span>${escapeHtml(target)}</span>`).join("");
    const labelHtml = extraLabels.length
      ? extraLabels.map(([key, value]) => `<span class="chip">${escapeHtml(key)}=${escapeHtml(value)}</span>`).join("")
      : `<span class="chip">无额外 labels</span>`;

    return `
      <tr>
        <td><div class="target-list">${targetHtml}</div></td>
        <td>${escapeHtml(labelValue(item, "instance"))}</td>
        <td>${escapeHtml(labelValue(item, "job"))}</td>
        <td>${escapeHtml(labelValue(item, "ip"))}</td>
        <td>${escapeHtml(labelValue(item, "price"))}</td>
        <td><div class="chips">${labelHtml}</div></td>
        <td class="right">
          <div class="row-actions">
            <button type="button" data-action="clone" data-index="${index}">复制</button>
            <button type="button" data-action="edit" data-index="${index}">编辑</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function addLabelRow(key = "", value = "") {
  const row = document.createElement("div");
  row.className = "label-row";
  row.innerHTML = `
    <input data-label-key placeholder="label key" value="${escapeHtml(key)}" />
    <input data-label-value placeholder="label value" value="${escapeHtml(value)}" />
    <button type="button" aria-label="删除 label">×</button>
  `;
  row.querySelector("button").addEventListener("click", () => row.remove());
  labelRows.appendChild(row);
}

function openEditor(index = null, seed = null) {
  editingIndex = index;
  const item = seed || (index === null
    ? { targets: [":9100"], labels: { job: "node-exporter-remote", ip: "", instance: "", price: "" } }
    : structuredClone(targets[index]));

  editorTitle.textContent = index === null ? "新增服务器" : "编辑服务器";
  deleteBtn.hidden = index === null;
  targetsInput.value = item.targets.join("\n");
  labelRows.innerHTML = "";
  Object.entries(item.labels || {}).forEach(([key, value]) => addLabelRow(key, value));
  editor.showModal();
}

function collectForm() {
  const itemTargets = targetsInput.value
    .split(/\n|,/)
    .map((target) => target.trim())
    .filter(Boolean);
  const labels = {};
  for (const row of labelRows.querySelectorAll(".label-row")) {
    const key = row.querySelector("[data-label-key]").value.trim();
    const value = row.querySelector("[data-label-value]").value.trim();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(labels, key)) {
      throw new Error(`label "${key}" 重复`);
    }
    labels[key] = value;
  }
  return { targets: itemTargets, labels };
}

async function loadTargets() {
  try {
    const data = await api("/api/targets");
    targets = data.targets;
    render();
    setStatus("已连接 targets.json");
  } catch (error) {
    setStatus(error.message, true);
  }
}

document.querySelector("#addBtn").addEventListener("click", () => openEditor());
document.querySelector("#addLabelBtn").addEventListener("click", () => addLabelRow());
document.querySelector("#closeBtn").addEventListener("click", () => editor.close());
document.querySelector("#cancelBtn").addEventListener("click", () => editor.close());
confirmOkBtn.addEventListener("click", () => confirmDialog.close());
backupCloseBtn.addEventListener("click", () => backupDialog.close());
searchInput.addEventListener("input", render);

document.querySelector("#backupBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/backup", { method: "POST", body: "{}" });
    const message = data.backup ? `备份成功：${data.backup}` : "当前没有可备份的 targets.json 文件。";
    setStatus(message);
    showConfirm(data.backup ? "备份成功" : "无需备份", message);
    if (backupDialog.open) await loadBackups();
  } catch (error) {
    setStatus(error.message, true);
  }
});

backupListBtn.addEventListener("click", async () => {
  try {
    backupDialog.showModal();
    await loadBackups();
  } catch (error) {
    backupDialog.close();
    setStatus(error.message, true);
  }
});

backupRows.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-backup]");
  if (!button) return;
  try {
    await selectBackup(button.dataset.backup);
  } catch (error) {
    setStatus(error.message, true);
  }
});

restoreBackupBtn.addEventListener("click", async () => {
  if (!selectedBackup) return;
  const ok = confirm(`确认恢复备份 ${selectedBackup.name}？当前 targets.json 会先自动备份，然后再恢复。`);
  if (!ok) return;
  try {
    const data = await api(`/api/backups/${encodeURIComponent(selectedBackup.name)}/restore`, {
      method: "POST",
      body: "{}",
    });
    targets = data.targets;
    render();
    await loadBackups();
    const message = data.backup
      ? `已恢复 ${data.restored.name}。恢复前文件已备份：${data.backup}`
      : `已恢复 ${data.restored.name}。`;
    setStatus(message);
    showConfirm("恢复成功", message);
  } catch (error) {
    setStatus(error.message, true);
  }
});

rowsEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const index = Number(button.dataset.index);
  if (button.dataset.action === "edit") {
    openEditor(index);
  }
  if (button.dataset.action === "clone") {
    const item = structuredClone(targets[index]);
    item.labels.instance = `${item.labels.instance || "server"}_copy`;
    openEditor(null, item);
  }
});

deleteBtn.addEventListener("click", async () => {
  if (editingIndex === null) return;
  const name = labelValue(targets[editingIndex], "instance") || targets[editingIndex].targets.join(", ");
  if (!confirm(`确认删除 ${name}？`)) return;
  try {
    const data = await api(`/api/targets/${editingIndex}`, { method: "DELETE" });
    targets = data.targets;
    editor.close();
    render();
    const message = data.backup
      ? `已删除并写入 targets.json。备份文件：${data.backup}`
      : "已删除并写入 targets.json。";
    setStatus(message);
    showConfirm("删除成功", message);
  } catch (error) {
    setStatus(error.message, true);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const item = collectForm();
    const method = editingIndex === null ? "POST" : "PUT";
    const path = editingIndex === null ? "/api/targets" : `/api/targets/${editingIndex}`;
    const data = await api(path, { method, body: JSON.stringify(item) });
    targets = data.targets;
    editor.close();
    render();
    const message = data.backup
      ? `已保存并写入 targets.json。备份文件：${data.backup}`
      : "已保存并写入 targets.json。";
    setStatus(message);
    showConfirm("保存成功", message);
  } catch (error) {
    setStatus(error.message, true);
  }
});

loadTargets();

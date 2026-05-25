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
const deleteBackupBtn = document.querySelector("#deleteBackupBtn");
const compareBackupBtn = document.querySelector("#compareBackupBtn");
const diffDialog = document.querySelector("#diffDialog");
const diffCloseBtn = document.querySelector("#diffCloseBtn");
const diffSummary = document.querySelector("#diffSummary");
const diffBackup = document.querySelector("#diffBackup");
const diffCurrent = document.querySelector("#diffCurrent");
const diffMap = document.querySelector("#diffMap");

let targets = [];
let editingIndex = null;
let backups = [];
let selectedBackup = null;
let selectedBackupTargets = null;
let diffRows = [];
let syncingDiffScroll = false;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#b42318" : "#667085";
}

function showConfirm(title, message) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmDialog.showModal();
}

function escapeDiff(value) {
  return escapeHtml(value || " ");
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
  selectedBackupTargets = null;
  backupName.textContent = "请选择备份";
  backupMeta.textContent = "";
  backupContent.textContent = "选择左侧备份后查看 JSON 内容。";
  restoreBackupBtn.disabled = true;
  deleteBackupBtn.disabled = true;
  compareBackupBtn.disabled = true;
  renderBackups();
}

async function selectBackup(name) {
  const data = await api(`/api/backups/${encodeURIComponent(name)}`);
  selectedBackup = data.backup;
  selectedBackupTargets = data.targets;
  backupName.textContent = data.backup.name;
  backupMeta.textContent = `${data.backup.modified} · ${formatBytes(data.backup.size)}`;
  backupContent.textContent = data.content;
  restoreBackupBtn.disabled = false;
  deleteBackupBtn.disabled = false;
  compareBackupBtn.disabled = false;
  renderBackups();
}

function buildDiffRows(leftText, rightText) {
  const left = leftText.split("\n");
  const right = rightText.split("\n");
  const operations = buildLineOperations(left, right);
  const rows = [];

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const lineIndex = rows.length;

    if (operation.type === "same") {
      rows.push({
        left: `<span class="diff-line same" data-line="${lineIndex}">${escapeDiff(operation.left)}</span>`,
        right: `<span class="diff-line same" data-line="${lineIndex}">${escapeDiff(operation.right)}</span>`,
        index: lineIndex,
        type: "same",
        different: false,
      });
      continue;
    }

    const leftLine = operation.left ?? "";
    const rightLine = operation.right ?? "";
    const leftClass = operation.type === "added" ? "empty" : operation.type;
    const rightClass = operation.type === "removed" ? "empty" : operation.type;

    rows.push({
      left: `<span class="diff-line ${leftClass}" data-line="${lineIndex}">${escapeDiff(leftLine)}</span>`,
      right: `<span class="diff-line ${rightClass}" data-line="${lineIndex}">${escapeDiff(rightLine)}</span>`,
      index: lineIndex,
      type: operation.type,
      different: true,
    });
  }

  return rows;
}

function buildLineOperations(left, right) {
  const rows = [];
  const m = left.length;
  const n = right.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const raw = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (left[i] === right[j]) {
      raw.push({ type: "same", left: left[i], right: right[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: "removed", left: left[i] });
      i += 1;
    } else {
      raw.push({ type: "added", right: right[j] });
      j += 1;
    }
  }
  while (i < m) {
    raw.push({ type: "removed", left: left[i] });
    i += 1;
  }
  while (j < n) {
    raw.push({ type: "added", right: right[j] });
    j += 1;
  }

  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (item.type === "same") {
      rows.push(item);
      continue;
    }

    const removed = [];
    const added = [];
    while (index < raw.length && raw[index].type !== "same") {
      if (raw[index].type === "removed") removed.push(raw[index].left);
      if (raw[index].type === "added") added.push(raw[index].right);
      index += 1;
    }
    index -= 1;

    const count = Math.max(removed.length, added.length);
    for (let changeIndex = 0; changeIndex < count; changeIndex += 1) {
      if (removed[changeIndex] !== undefined && added[changeIndex] !== undefined) {
        rows.push({ type: "changed", left: removed[changeIndex], right: added[changeIndex] });
      } else if (removed[changeIndex] !== undefined) {
        rows.push({ type: "removed", left: removed[changeIndex] });
      } else {
        rows.push({ type: "added", right: added[changeIndex] });
      }
    }
  }

  return rows;
}

function renderDiffMap(rows) {
  const changedRows = rows.filter((row) => row.different);
  const total = Math.max(rows.length - 1, 1);

  diffMap.innerHTML = changedRows.map((row) => {
    const top = (row.index / total) * 100;
    const height = Math.max(4, 100 / Math.max(rows.length, 1));
    return `
      <button
        type="button"
        class="diff-map-marker ${row.type}"
        data-line="${row.index}"
        title="第 ${row.index + 1} 行：${row.type}"
        style="top: calc(${top}% - 2px); height: ${height}px"
      ></button>
    `;
  }).join("");
}

function focusDiffLine(lineIndex) {
  diffBackup.querySelectorAll(".focused").forEach((node) => node.classList.remove("focused"));
  diffCurrent.querySelectorAll(".focused").forEach((node) => node.classList.remove("focused"));
  diffMap.querySelectorAll(".active").forEach((node) => node.classList.remove("active"));

  const leftLine = diffBackup.querySelector(`[data-line="${lineIndex}"]`);
  const rightLine = diffCurrent.querySelector(`[data-line="${lineIndex}"]`);
  const marker = diffMap.querySelector(`[data-line="${lineIndex}"]`);

  leftLine?.classList.add("focused");
  rightLine?.classList.add("focused");
  marker?.classList.add("active");

  const targetTop = Math.max(0, (leftLine?.offsetTop || rightLine?.offsetTop || 0) - 80);
  syncingDiffScroll = true;
  diffBackup.scrollTop = targetTop;
  diffCurrent.scrollTop = targetTop;
  requestAnimationFrame(() => {
    syncingDiffScroll = false;
  });
}

function syncDiffScroll(source, target) {
  if (syncingDiffScroll) return;
  syncingDiffScroll = true;
  const sourceMax = Math.max(source.scrollHeight - source.clientHeight, 1);
  const targetMax = Math.max(target.scrollHeight - target.clientHeight, 1);
  target.scrollTop = (source.scrollTop / sourceMax) * targetMax;
  requestAnimationFrame(() => {
    syncingDiffScroll = false;
  });
}

async function compareSelectedBackup() {
  if (!selectedBackup || !selectedBackupTargets) return;
  const currentData = await api("/api/targets");
  targets = currentData.targets;
  render();

  const backupText = JSON.stringify(selectedBackupTargets, null, 2);
  const currentText = JSON.stringify(targets, null, 2);
  diffRows = buildDiffRows(backupText, currentText);
  const diffCount = diffRows.filter((row) => row.different).length;

  diffBackup.innerHTML = diffRows.map((row) => row.left).join("");
  diffCurrent.innerHTML = diffRows.map((row) => row.right).join("");
  renderDiffMap(diffRows);
  diffSummary.textContent = diffCount
    ? `${selectedBackup.name} 与当前文件有 ${diffCount} 行差异`
    : `${selectedBackup.name} 与当前文件一致`;
  diffDialog.showModal();

  const firstDiff = diffRows.find((row) => row.different);
  if (firstDiff) {
    requestAnimationFrame(() => focusDiffLine(firstDiff.index));
  }
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
diffCloseBtn.addEventListener("click", () => diffDialog.close());
searchInput.addEventListener("input", render);
diffBackup.addEventListener("scroll", () => syncDiffScroll(diffBackup, diffCurrent));
diffCurrent.addEventListener("scroll", () => syncDiffScroll(diffCurrent, diffBackup));
diffMap.addEventListener("click", (event) => {
  const marker = event.target.closest(".diff-map-marker");
  if (!marker) return;
  focusDiffLine(Number(marker.dataset.line));
});

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

deleteBackupBtn.addEventListener("click", async () => {
  if (!selectedBackup) return;
  const ok = confirm(`确认删除备份 ${selectedBackup.name}？此操作不会修改当前 targets.json。`);
  if (!ok) return;
  try {
    const data = await api(`/api/backups/${encodeURIComponent(selectedBackup.name)}`, {
      method: "DELETE",
    });
    backups = data.backups;
    selectedBackup = null;
    selectedBackupTargets = null;
    backupName.textContent = "请选择备份";
    backupMeta.textContent = "";
    backupContent.textContent = "选择左侧备份后查看 JSON 内容。";
    restoreBackupBtn.disabled = true;
    deleteBackupBtn.disabled = true;
    compareBackupBtn.disabled = true;
    renderBackups();
    const message = `已删除备份：${data.deleted.name}`;
    setStatus(message);
    showConfirm("删除备份成功", message);
  } catch (error) {
    setStatus(error.message, true);
  }
});

compareBackupBtn.addEventListener("click", async () => {
  try {
    await compareSelectedBackup();
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

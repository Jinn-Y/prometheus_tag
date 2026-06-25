const rowsEl = document.querySelector("#targetRows");
const summaryEl = document.querySelector("#summary");
const statusEl = document.querySelector("#status");
const searchInput = document.querySelector("#searchInput");
const editor = document.querySelector("#editor");
const form = document.querySelector("#targetForm");
const editorTitle = document.querySelector("#editorTitle");
const targetsInput = document.querySelector("#targetsInput");
const labelRows = document.querySelector("#labelRows");
const confirmDialog = document.querySelector("#confirmDialog");
const confirmTitle = document.querySelector("#confirmTitle");
const confirmMessage = document.querySelector("#confirmMessage");
const confirmOkBtn = document.querySelector("#confirmOkBtn");
const deleteConfirmDialog = document.querySelector("#deleteConfirmDialog");
const deleteConfirmMessage = document.querySelector("#deleteConfirmMessage");
const deleteCancelBtn = document.querySelector("#deleteCancelBtn");
const deleteConfirmBtn = document.querySelector("#deleteConfirmBtn");
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

let currentPage = 1;
const pageSize = 10;
let lastKeyword = "";

function setStatus(text, isError = false) {
  statusEl.innerHTML = `
    <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${isError ? 'var(--danger)' : 'var(--accent)'}; box-shadow: 0 0 6px ${isError ? 'var(--danger)' : 'var(--accent)'}; margin-right: 4px; transform: translateY(-1px);"></span>
    ${escapeHtml(text)}
  `;
  statusEl.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function showConfirm(title, message) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmDialog.showModal();
}

function askDeleteConfirmation(item) {
  const name = labelValue(item, "instance") || item.targets.join(", ");
  deleteConfirmMessage.textContent = `确认删除 ${name}？删除前会自动备份当前 targets.json。`;
  deleteConfirmDialog.showModal();

  return new Promise((resolve) => {
    const cleanup = (confirmed) => {
      deleteCancelBtn.removeEventListener("click", onCancel);
      deleteConfirmBtn.removeEventListener("click", onConfirm);
      deleteConfirmDialog.removeEventListener("close", onClose);
      if (deleteConfirmDialog.open) {
        deleteConfirmDialog.close();
      }
      resolve(confirmed);
    };
    const onCancel = () => cleanup(false);
    const onConfirm = () => cleanup(true);
    const onClose = () => cleanup(false);

    deleteCancelBtn.addEventListener("click", onCancel, { once: true });
    deleteConfirmBtn.addEventListener("click", onConfirm, { once: true });
    deleteConfirmDialog.addEventListener("close", onClose, { once: true });
  });
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
  if (keyword !== lastKeyword) {
    currentPage = 1;
    lastKeyword = keyword;
  }

  const visible = targets
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => JSON.stringify(item).toLowerCase().includes(keyword));

  summaryEl.textContent = `当前 ${targets.length} 台服务器，显示 ${visible.length} 台`;

  const totalPages = Math.ceil(visible.length / pageSize) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageItems = visible.slice(start, end);

  rowsEl.innerHTML = pageItems.map(({ item, index }) => {
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
            <button type="button" data-action="clone" data-index="${index}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              复制
            </button>
            <button type="button" data-action="edit" data-index="${index}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              编辑
            </button>
            <button type="button" class="danger" data-action="delete" data-index="${index}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              删除
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  renderPagination(targets.length, visible.length);
}

function renderPagination(totalCount, filteredCount) {
  const paginationEl = document.querySelector("#pagination");
  if (!paginationEl) return;

  const totalPages = Math.ceil(filteredCount / pageSize) || 1;
  const startItem = filteredCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, filteredCount);

  let pageButtons = [];
  // 上一页
  pageButtons.push(`
    <button type="button" class="page-btn" id="prevPageBtn" ${currentPage === 1 ? "disabled" : ""}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      上一页
    </button>
  `);

  // 页码数字
  for (let i = 1; i <= totalPages; i++) {
    pageButtons.push(`
      <button type="button" class="page-num-btn ${i === currentPage ? "active" : ""}" data-page="${i}">
        ${i}
      </button>
    `);
  }

  // 下一页
  pageButtons.push(`
    <button type="button" class="page-btn" id="nextPageBtn" ${currentPage === totalPages ? "disabled" : ""}>
      下一页
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
  `);

  paginationEl.innerHTML = `
    <div class="pagination-info">
      显示 <span>${startItem}</span> - <span>${endItem}</span> 条，共 <span>${filteredCount}</span> 条
    </div>
    <div class="pagination-actions">
      ${pageButtons.join("")}
    </div>
  `;

  // 绑定事件
  const prevBtn = paginationEl.querySelector("#prevPageBtn");
  const nextBtn = paginationEl.querySelector("#nextPageBtn");

  if (prevBtn && currentPage > 1) {
    prevBtn.addEventListener("click", () => {
      currentPage--;
      render();
    });
  }
  if (nextBtn && currentPage < totalPages) {
    nextBtn.addEventListener("click", () => {
      currentPage++;
      render();
    });
  }
  paginationEl.querySelectorAll(".page-num-btn[data-page]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      currentPage = Number(e.currentTarget.dataset.page);
      render();
    });
  });
}

function addLabelRow(key = "", value = "") {
  const row = document.createElement("div");
  row.className = "label-row";
  row.innerHTML = `
    <div class="label-input-group">
      <input data-label-key placeholder="键 (Key)" value="${escapeHtml(key)}" />
      <input data-label-value placeholder="值 (Value)" value="${escapeHtml(value)}" />
    </div>
    <button type="button" class="label-delete-btn" aria-label="删除 label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
    </button>
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

async function deleteTarget(index) {
  const ok = await askDeleteConfirmation(targets[index]);
  if (!ok) return;
  try {
    const data = await api(`/api/targets/${index}`, { method: "DELETE" });
    targets = data.targets;
    render();
    const message = data.backup
      ? `已删除并写入 targets.json。备份文件：${data.backup}`
      : "已删除并写入 targets.json。";
    setStatus(message);
    showConfirm("删除成功", message);
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

rowsEl.addEventListener("click", async (event) => {
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
  if (button.dataset.action === "delete") {
    await deleteTarget(index);
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

// 主题切换逻辑
const themeToggleBtn = document.querySelector("#themeToggleBtn");

function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);
}

function updateThemeIcon(theme) {
  if (!themeToggleBtn) return;
  if (theme === "light") {
    themeToggleBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    `;
  } else {
    themeToggleBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    `;
  }
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    const nextTheme = currentTheme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", nextTheme);
    localStorage.setItem("theme", nextTheme);
    updateThemeIcon(nextTheme);
  });
}

initTheme();

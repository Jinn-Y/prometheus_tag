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

let targets = [];
let editingIndex = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#b42318" : "#667085";
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
searchInput.addEventListener("input", render);

document.querySelector("#backupBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/backup", { method: "POST", body: "{}" });
    setStatus(data.backup ? `已备份：${data.backup}` : "没有可备份文件");
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
    setStatus("已删除并写入 targets.json");
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
    setStatus("已保存并写入 targets.json");
  } catch (error) {
    setStatus(error.message, true);
  }
});

loadTargets();

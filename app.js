const DAYS = [
  { key: "mon", label: "월", count: 7 },
  { key: "tue", label: "화", count: 7 },
  { key: "wed", label: "수", count: 7 },
  { key: "thu", label: "목", count: 6 },
  { key: "fri", label: "금", count: 5 }
];
const BELL = [
  ["08:40","09:30"], ["09:40","10:30"], ["10:40","11:30"],
  ["11:40","12:30"], ["13:30","14:20"], ["14:40","15:30"], ["15:40","16:30"]
];
const KST = "Asia/Seoul";

let bundledData;
let data;
let selected = null;
let selectedType = "";
let toastTimer;
let encryptedBundle;
let activeKey;
let idleTimer;
const AUTO_LOCK_MS = 15 * 60 * 1000;

const $ = id => document.getElementById(id);
const normalize = text => (text || "").replace(/\s+/g, "").toLowerCase();
const isContinuation = value => ["─▷", "──", "→", "-"].includes(value);
const slots = (item, day) => item?.slots?.[day] || [];

function displayCell(values, index) {
  if (index < 0 || index >= values.length) return "";
  const value = String(values[index] || "").trim();
  if (!value) return "";
  if (!isContinuation(value)) return value;
  for (let i = index - 1; i >= 0; i--) {
    const previous = String(values[i] || "").trim();
    if (previous && !isContinuation(previous)) return `${previous} 연속`;
  }
  return "연속 수업";
}

function kstParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KST, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function currentInfo() {
  const parts = kstParts();
  const dayIndex = ["Mon","Tue","Wed","Thu","Fri"].indexOf(parts.weekday);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  let period = 0;
  for (let i = 0; i < BELL.length; i++) {
    const start = toMinutes(BELL[i][0]);
    const end = toMinutes(BELL[i][1]);
    if (minutes >= start && minutes <= end) { period = i + 1; break; }
  }
  return { dayIndex, period, hour: parts.hour, minute: parts.minute };
}

function toMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function updateClock() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("ko-KR", { timeZone: KST, month: "short", day: "numeric", weekday: "short" }).format(now);
  const time = new Intl.DateTimeFormat("ko-KR", { timeZone: KST, hour: "2-digit", minute: "2-digit" }).format(now);
  $("clock").textContent = `${date}\n${time}`;
}

function findTarget() {
  const query = normalize($("searchInput").value);
  selected = null;
  selectedType = "";
  if (!query) {
    $("matchText").textContent = "검색 대기";
    updateSearchView();
    return;
  }
  const mode = $("searchMode").value;
  const groups = [];
  if (mode !== "학반") groups.push(["teacher", data.teachers]);
  if (mode !== "교사") groups.push(["class", data.classes]);
  for (const [type, items] of groups) {
    const match = items.find(item => normalize(item.name).includes(query));
    if (match) {
      selected = match;
      selectedType = type;
      $("matchText").textContent = `${type === "teacher" ? "교사" : "학반"}  ${match.name}`;
      updateSearchView();
      return;
    }
  }
  $("matchText").textContent = "검색 결과 없음";
  updateSearchView();
}

function setStatus(main, detail, kind) {
  $("statusMain").textContent = main;
  $("statusMain").className = `status-main ${kind}`;
  $("statusDetail").textContent = detail;
}

function updateSearchView() {
  const row = $("todayPeriods");
  row.replaceChildren();
  if (!selected) {
    setStatus("대기", "검색어를 입력하세요.", "neutral");
    $("todayTitle").textContent = "오늘 시간표";
    for (let i = 0; i < 7; i++) row.append(periodCard(i + 1, "—", false));
    return;
  }
  const info = currentInfo();
  const name = `${selectedType === "teacher" ? "교사" : "학반"} ${selected.name}`;
  if (info.dayIndex < 0) setStatus("주말", `${name} · 등록된 수업 없음`, "neutral");
  else if (!info.period) setStatus("교시 아님", `${name} · ${DAYS[info.dayIndex].label}요일`, "warning");
  else {
    const lesson = displayCell(slots(selected, DAYS[info.dayIndex].key), info.period - 1);
    if (lesson) setStatus("수업 있음", `${name} · ${info.period}교시 ${lesson}`, "success");
    else setStatus("수업 없음", `${name} · ${info.period}교시 공강`, "danger");
  }
  if (info.dayIndex < 0) {
    $("todayTitle").textContent = "오늘 시간표 · 주말";
    for (let i = 0; i < 7; i++) row.append(periodCard(i + 1, "공강", false));
    return;
  }
  $("todayTitle").textContent = `오늘 시간표 · ${DAYS[info.dayIndex].label}요일`;
  const values = slots(selected, DAYS[info.dayIndex].key);
  for (let i = 0; i < 7; i++) {
    const value = displayCell(values, i) || "공강";
    row.append(periodCard(i + 1, value, info.period === i + 1));
  }
}

function periodCard(period, value, current) {
  const card = document.createElement("article");
  card.className = `period-card${current ? " current" : ""}${value === "공강" ? " free" : ""}`;
  const heading = document.createElement("b");
  heading.textContent = `${period}교시`;
  const body = document.createElement("span");
  body.textContent = value;
  card.append(heading, body);
  return card;
}

function updateOverview() {
  const info = currentInfo();
  let active = 0;
  const rows = data.teachers.map(teacher => {
    let lesson = "수업 없음";
    let hasClass = false;
    if (info.dayIndex < 0) lesson = "주말";
    else if (!info.period) lesson = "교시 아님";
    else {
      lesson = displayCell(slots(teacher, DAYS[info.dayIndex].key), info.period - 1);
      hasClass = Boolean(lesson);
      if (!hasClass) lesson = "수업 없음";
    }
    if (hasClass) active++;
    return { name: teacher.name, lesson, active: hasClass };
  }).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, "ko"));

  const periodText = info.dayIndex < 0 ? "주말" : info.period ? `${info.period}교시` : "교시 아님";
  $("overviewSummary").textContent = `${periodText} · 수업 중 ${active}명 · 수업 없음 ${data.teachers.length - active}명`;
  const list = $("overviewList");
  list.replaceChildren(...rows.map(row => {
    const item = document.createElement("article");
    item.className = `teacher-row${row.active ? " active" : ""}`;
    item.innerHTML = `<span class="dot">●</span><span class="name"></span><span class="lesson"></span>`;
    item.querySelector(".name").textContent = row.name;
    item.querySelector(".lesson").textContent = row.lesson;
    return item;
  }));
}

function showWeek() {
  if (!selected) return showToast("먼저 교사명 또는 학반을 검색하세요.");
  const info = currentInfo();
  $("weekTitle").textContent = `${selected.name} 주간 시간표`;
  const table = $("weekTable");
  table.replaceChildren();
  const head = document.createElement("tr");
  head.innerHTML = "<th>요일</th>" + Array.from({length: 7}, (_, i) => `<th>${i + 1}교시</th>`).join("");
  table.append(head);
  DAYS.forEach((day, dayIndex) => {
    const tr = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = day.label;
    tr.append(label);
    const values = slots(selected, day.key);
    for (let i = 0; i < 7; i++) {
      const td = document.createElement("td");
      td.textContent = displayCell(values, i) || "공강";
      if (info.dayIndex === dayIndex && info.period === i + 1) td.className = "current";
      tr.append(td);
    }
    table.append(tr);
  });
  $("weekDialog").showModal();
}

function updateManage() {
  const custom = localStorage.getItem("encryptedCustomData");
  $("manageStatus").textContent =
    `${custom ? "사용자 시간표" : "내장 기본 시간표"}\n${data.source}\n교사 ${data.teachers.length}명 · 학반 ${data.classes.length}개`;
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function bytesToBase64(value) {
  let binary = "";
  const bytes = new Uint8Array(value);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function deriveKey(password) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey({
    name: "PBKDF2",
    salt: base64ToBytes(encryptedBundle.salt),
    iterations: encryptedBundle.iterations,
    hash: "SHA-256"
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function decryptPayload(payload, key) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function encryptPayload(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(encrypted) };
}

function resetIdleTimer() {
  if (!activeKey) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(lockApp, AUTO_LOCK_MS);
}

function lockApp() {
  activeKey = null;
  data = null;
  selected = null;
  selectedType = "";
  clearTimeout(idleTimer);
  $("passwordInput").value = "";
  $("lockError").textContent = "";
  $("lockScreen").classList.remove("hidden");
  document.body.classList.add("locked");
  setTimeout(() => $("passwordInput").focus(), 50);
}

async function unlockApp(password) {
  const key = await deriveKey(password);
  const original = await decryptPayload(encryptedBundle, key);
  let restored = original;
  const customRaw = localStorage.getItem("encryptedCustomData");
  if (customRaw) {
    try {
      restored = await decryptPayload(JSON.parse(customRaw), key);
    } catch {
      localStorage.removeItem("encryptedCustomData");
      restored = original;
    }
  }
  bundledData = original;
  data = restored;
  activeKey = key;
  $("passwordInput").value = "";
  $("lockScreen").classList.add("hidden");
  document.body.classList.remove("locked");
  updateClock();
  updateSearchView();
  updateOverview();
  updateManage();
  resetIdleTimer();
}

async function importHwpx(file) {
  if (!window.JSZip) throw new Error("HWPX 분석 모듈을 불러오지 못했습니다.");
  const zip = await JSZip.loadAsync(file);
  const section = zip.file("Contents/section0.xml");
  if (!section) throw new Error("HWPX 본문을 찾지 못했습니다.");
  const xmlText = await section.async("text");
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("HWPX 본문 형식이 올바르지 않습니다.");
  const tables = allByLocalName(xml, "tbl");
  if (tables.length < 2) throw new Error("교사/학반 시간표 표를 찾지 못했습니다.");

  const teachers = [];
  const teacherRows = directChildrenByLocalName(tables[0], "tr");
  for (let i = 4; i < teacherRows.length; i++) {
    const cells = cellTexts(teacherRows[i]);
    if (cells.length < 35 || !cells[1]?.trim()) continue;
    teachers.push({
      no: cells[0], name: cells[1], slots: slotsFromCells(cells, 2),
      hours: cells[34], homeroom: cells[36] || "", note: cells[37] || ""
    });
  }
  const classes = [];
  const classRows = directChildrenByLocalName(tables[1], "tr");
  for (let i = 4; i < classRows.length; i++) {
    const cells = cellTexts(classRows[i]);
    if (cells.length < 32 || !cells[0]?.trim()) continue;
    classes.push({
      name: cells[0], slots: slotsFromCells(cells, 1),
      homeroom: cells[34] || "", note: cells[35] || ""
    });
  }
  if (!teachers.length || !classes.length) throw new Error("시간표 행을 읽지 못했습니다.");
  return {
    source: file.name, school: "경북하이텍고등학교", semester: "사용자 불러오기",
    days: DAYS, teachers, classes
  };
}

function allByLocalName(root, name) {
  return [...root.getElementsByTagName("*")].filter(node => node.localName === name || node.nodeName.split(":").pop() === name);
}
function directChildrenByLocalName(root, name) {
  return [...root.children].filter(node => node.localName === name || node.nodeName.split(":").pop() === name);
}
function cellTexts(row) {
  return directChildrenByLocalName(row, "tc").map(cell =>
    allByLocalName(cell, "t").map(node => node.textContent).join("").trim()
  );
}
function slotsFromCells(cells, start) {
  const result = {};
  let index = start;
  for (const day of DAYS) {
    result[day.key] = [];
    for (let i = 0; i < day.count; i++) result[day.key].push(cells[index++] || "");
  }
  return result;
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === pageId));
  document.querySelectorAll(".bottom-nav button").forEach(button => button.classList.toggle("active", button.dataset.page === pageId));
  if (pageId === "overviewPage") updateOverview();
  if (pageId === "managePage") updateManage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.add("show");
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}

async function initialize() {
  encryptedBundle = await fetch("encrypted-data.json").then(response => response.json());
  document.body.classList.add("locked");
  $("unlockForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    $("lockError").textContent = "";
    try {
      await unlockApp($("passwordInput").value);
    } catch {
      $("lockError").textContent = "비밀번호가 올바르지 않습니다.";
      $("passwordInput").select();
    } finally {
      button.disabled = false;
    }
  });
  $("searchInput").addEventListener("input", findTarget);
  $("searchMode").addEventListener("change", findTarget);
  $("weekButton").addEventListener("click", showWeek);
  $("closeWeek").addEventListener("click", () => $("weekDialog").close());
  document.querySelectorAll(".bottom-nav button").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
  $("resetButton").addEventListener("click", () => {
    if (!confirm("불러온 사용자 시간표를 삭제하고 기본 시간표로 되돌릴까요?")) return;
    localStorage.removeItem("encryptedCustomData");
    data = bundledData;
    selected = null;
    selectedType = "";
    updateManage();
    updateSearchView();
    updateOverview();
    showToast("기본 시간표로 되돌렸습니다.");
  });
  $("lockButton").addEventListener("click", lockApp);
  $("hwpxInput").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    showToast("HWPX 파일을 분석하고 있습니다…");
    try {
      const imported = await importHwpx(file);
      const encrypted = await encryptPayload(imported, activeKey);
      localStorage.setItem("encryptedCustomData", JSON.stringify(encrypted));
      data = imported;
      selected = null;
      selectedType = "";
      updateManage();
      updateOverview();
      updateSearchView();
      showToast(`저장 완료 · 교사 ${data.teachers.length}명 · 학반 ${data.classes.length}개`);
    } catch (error) {
      showToast(`불러오기 실패: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  });
  updateClock();
  setInterval(() => {
    if (!activeKey || !data) return;
    updateClock();
    updateSearchView();
    updateOverview();
  }, 30000);
  ["pointerdown", "keydown", "touchstart"].forEach(name =>
    document.addEventListener(name, resetIdleTimer, { passive: true })
  );
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) resetIdleTimer();
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js");
  setTimeout(() => $("passwordInput").focus(), 100);
}

initialize().catch(error => {
  console.error(error);
  showToast("시간표 데이터를 불러오지 못했습니다.");
});

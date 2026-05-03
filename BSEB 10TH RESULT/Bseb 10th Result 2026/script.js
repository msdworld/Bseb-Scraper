const axios = require("axios");
const fs = require("fs");
const path = require("path");

// =============================
// 🔧 CHANGE EVERY RUN
// =============================
const DISTRICT_PREFIX = "24";
const OUTPUT_FILE_NAME = "sheikhpura-24-bseb-10th-full-result-2026.json";

// =============================
const BASE_DIR = __dirname;
const OUTPUT_PATH = path.join(BASE_DIR, OUTPUT_FILE_NAME);

// ✅ FINAL FIX (NO ERROR EVER)
const SCHOOL_LIST_FILE = path.join(process.cwd(), "bseb-10th-school-list-2026.json");

// Roll range
const START_ROLL = 2600001;
const END_ROLL = 2600999;

// SPEED
const CONCURRENCY = 150;
const BATCH_SIZE = 100;
const TIMEOUT = 3000;

// =============================
const API_URL = "https://resultapi.biharboardonline.org/result";

const client = axios.create({
  timeout: TIMEOUT,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://result.biharboardonline.org/",
    "Origin": "https://result.biharboardonline.org"
  }
});

// =============================
// HELPERS
// =============================
function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function normalize(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";
  return String(Number(s));
}

// =============================
// SUBJECT LOGIC (FULL PRESERVED)
// =============================
function buildPractical(sub) {
  const p = normalize(sub.project_work);
  const l = normalize(sub.literacy_activity);
  const ia = normalize(sub.ia_sci);
  const pr = normalize(sub.practical);

  if (sub.sub_code === "111") {
    const arr = [];
    if (p) arr.push(p);
    if (l) arr.push(l);
    return arr.join("+");
  }

  if (sub.sub_code === "112") {
    if (ia) return ia;
  }

  if (pr) return pr;

  const arr = [];
  if (p) arr.push(p);
  if (l) arr.push(l);
  if (ia) arr.push(ia);

  return arr.join("+");
}

function formatSubjects(subjects = []) {
  return subjects.map(sub => {
    const obj = {
      subCode: clean(sub.sub_code),
      subject: clean(sub.sub_name),
      theory: normalize(sub.theory),
      subGroupId: clean(sub.sub_group_id),
      subTotal: normalize(sub.sub_total)
    };

    const practical = buildPractical(sub);
    if (practical) obj.practical = practical;

    if (clean(sub.sub_result)) obj.subResult = clean(sub.sub_result);
    if (clean(sub.regulation)) obj.regulation = clean(sub.regulation);
    if (clean(sub.cce)) obj.cce = clean(sub.cce);

    return obj;
  });
}

// =============================
// STUDENT FORMAT
// =============================
function formatStudent(d) {
  const student = {
    studentName: clean(d.name),
    fatherName: clean(d.father_name),
    regNumber: clean(d.reg_no),
    BSEBUniqueId: clean(d.bseb_id),
    schoolName: clean(d.school_name),
    rollCode: clean(d.roll_code),
    rollNo: clean(d.roll_no),
    examType: clean(d.exam_type),
    totalMarks: normalize(d.total),
    division: clean(d.division)
  };

  // ✅ MUST BE AFTER DIVISION
  if (clean(d.passed_under_regulation)) {
    student.passedUnderRegulation = clean(d.passed_under_regulation);
  }

  student.subjects = formatSubjects(d.subjects);

  return student;
}

// =============================
// LOAD EXISTING
// =============================
let data = {};
if (fs.existsSync(OUTPUT_PATH)) {
  console.log("📂 Loading existing data...");
  data = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
}

// =============================
// LOAD SCHOOL LIST
// =============================
if (!fs.existsSync(SCHOOL_LIST_FILE)) {
  console.log("❌ School list missing:", SCHOOL_LIST_FILE);
  process.exit(1);
}

const schoolList = JSON.parse(fs.readFileSync(SCHOOL_LIST_FILE, "utf8"));

const rollCodes = Object.keys(schoolList)
  .filter(rc => rc.startsWith(DISTRICT_PREFIX))
  .sort((a, b) => Number(a) - Number(b));

// =============================
// FETCH
// =============================
async function fetchResult(rc, rn) {
  try {
    const res = await client.get(API_URL, {
      params: { roll_code: rc, roll_no: rn }
    });

    if (!res.data?.success) return null;

    const student = formatStudent(res.data.data);

    if (!student.studentName) return null;

    return student;
  } catch {
    return null;
  }
}

// =============================
// SAVE FORMAT (🔥 PERFECT MATCH)
// =============================
function saveJSON() {
  const lines = ["{"];

  const rcKeys = Object.keys(data).sort((a, b) => Number(a) - Number(b));

  rcKeys.forEach((rc, rci) => {
    lines.push(`  "${rc}": {`);

    const rnKeys = Object.keys(data[rc]).sort((a, b) => Number(a) - Number(b));

    rnKeys.forEach((rn, rni) => {
      const student = data[rc][rn];

      const subjects = JSON.stringify(student.subjects);

      const temp = { ...student };
      delete temp.subjects;

      const json = JSON.stringify(temp, null, 6).split("\n");

      json.forEach((line, i) => {
        if (i === 0) {
          lines.push(`    "${rn}": ${line}`);
        } else {
          lines.push(`    ${line}`);
        }
      });

      // ✅ EACH SUBJECT ONE LINE
      student.subjects.forEach(sub => {
        lines.push(`      ,${JSON.stringify(sub)}`);
      });

      lines.push(`    }${rni < rnKeys.length - 1 ? "," : ""}`);
    });

    lines.push(`  }${rci < rcKeys.length - 1 ? "," : ""}`);
  });

  lines.push("}");

  fs.writeFileSync(OUTPUT_PATH, lines.join("\n"), "utf8");
}

// =============================
// MAIN
// =============================
(async () => {
  let totalSaved = 0;

  for (const rc of rollCodes) {
    if (!data[rc]) data[rc] = {};

    console.log(`🚀 Started ${rc} from ${START_ROLL}`);

    for (let rn = START_ROLL; rn <= END_ROLL; rn += BATCH_SIZE) {
      const batch = [];

      for (let i = rn; i < rn + BATCH_SIZE && i <= END_ROLL; i++) {
        if (!data[rc][i]) batch.push(i);
      }

      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunk = batch.slice(i, i + CONCURRENCY);

        const results = await Promise.all(
          chunk.map(r => fetchResult(rc, r))
        );

        results.forEach((res, idx) => {
          if (res) {
            const rollNo = chunk[idx];
            data[rc][rollNo] = res;
            totalSaved++;
            console.log(`✅ Saved ${rollNo}`);
          }
        });
      }
    }
  }

  saveJSON();

  console.log("================================");
  console.log(`🎓 This run saved total: ${totalSaved}`);
  console.log("🎉 Completed.");
})();

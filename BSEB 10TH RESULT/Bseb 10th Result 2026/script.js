const axios = require("axios");
const fs = require("fs");
const path = require("path");

// =============================
// 🔧 CHANGE EVERY RUN
// =============================
const DISTRICT_PREFIX = "92";
const OUTPUT_FILE_NAME = "siwan-92-bseb-10th-full-result-2026.json";

// =============================
const BASE_DIR = __dirname;
const OUTPUT_PATH = path.join(BASE_DIR, OUTPUT_FILE_NAME);
const SCHOOL_LIST_FILE = path.join(__dirname, "../../../bseb-10th-school-list-2026.json");

// Roll range
const ROLLNO_START = 2600001;
const ROLLNO_END = 2600002;

// SPEED
const CONCURRENCY = 200;
const BATCH_SIZE = 999;

// =============================
// AXIOS
// =============================
const client = axios.create({
  timeout: 6000,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://result.biharboardonline.org/",
    "Origin": "https://result.biharboardonline.org"
  }
});

// =============================
// HELPERS
// =============================
function clean(txt) {
  return String(txt || "").replace(/\s+/g, " ").trim();
}

function normalizeMarks(val) {
  if (!val) return "";
  return String(Number(val));
}

// =============================
// SUBJECT FORMAT (ONE LINE)
// =============================
function buildPractical(sub) {
  const p = normalizeMarks(sub.practical);
  const pw = normalizeMarks(sub.project_work);
  const la = normalizeMarks(sub.literacy_activity);
  const ia = normalizeMarks(sub.ia_sci);

  if (sub.sub_code === "111") return [pw, la].filter(Boolean).join("+");
  if (sub.sub_code === "112") return ia || "";

  return p || [pw, la, ia].filter(Boolean).join("+");
}

function formatSubjects(subjects = []) {
  return subjects.map(sub => {
    const obj = {
      subCode: clean(sub.sub_code),
      subject: clean(sub.sub_name),
      theory: normalizeMarks(sub.theory),
      subGroupId: clean(sub.sub_group_id),
      subTotal: normalizeMarks(sub.sub_total)
    };

    const practical = buildPractical(sub);
    if (practical) obj.practical = practical;

    if (sub.sub_result) obj.subResult = clean(sub.sub_result);

    return obj;
  });
}

// =============================
// STUDENT FORMAT
// =============================
function formatStudent(data) {
  const student = {
    studentName: clean(data.name),
    fatherName: clean(data.father_name),
    regNumber: clean(data.reg_no),
    BSEBUniqueId: clean(data.bseb_id),
    schoolName: clean(data.school_name),
    rollCode: clean(data.roll_code),
    rollNo: clean(data.roll_no),
    examType: clean(data.exam_type),
    totalMarks: normalizeMarks(data.total),
    division: clean(data.division)
  };

  // ✅ CORRECT POSITION
  if (data.passed_under_regulation) {
    student.passedUnderRegulation = clean(data.passed_under_regulation);
  }

  student.subjects = formatSubjects(data.subjects);

  return student;
}

// =============================
// LOAD DATA
// =============================
let outputData = {};

if (fs.existsSync(OUTPUT_PATH)) {
  console.log("📂 Loading existing data...");
  outputData = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
}

const schoolList = JSON.parse(fs.readFileSync(SCHOOL_LIST_FILE, "utf8"));

const rollCodes = Object.keys(schoolList)
  .filter(rc => rc.startsWith(DISTRICT_PREFIX))
  .sort((a, b) => Number(a) - Number(b));

// =============================
// FETCH
// =============================
async function fetchStudent(rollCode, rollNo) {
  try {
    const res = await client.get("https://resultapi.biharboardonline.org/result", {
      params: { roll_code: rollCode, roll_no: rollNo }
    });

    if (!res.data?.success || !res.data?.data) return null;

    const student = formatStudent(res.data.data);

    if (student.studentName) return student;

    return null;
  } catch {
    return null;
  }
}

// =============================
// SAVE
// =============================
function saveFile() {
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputData, null, 2));
}

// =============================
// MAIN
// =============================
(async () => {
  let totalSaved = 0;

  for (const rollCode of rollCodes) {
    if (!outputData[rollCode]) outputData[rollCode] = {};

    console.log(`🚀 Started ${rollCode} from ${ROLLNO_START}`);

    for (let start = ROLLNO_START; start <= ROLLNO_END; start += BATCH_SIZE) {
      const batch = [];

      for (let i = start; i < start + BATCH_SIZE && i <= ROLLNO_END; i++) {
        if (!outputData[rollCode][i]) batch.push(i);
      }

      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunk = batch.slice(i, i + CONCURRENCY);

        const results = await Promise.all(
          chunk.map(rn => fetchStudent(rollCode, rn))
        );

        results.forEach((res, idx) => {
          if (res) {
            const rn = chunk[idx];
            outputData[rollCode][rn] = res;
            totalSaved++;
            console.log(`💾 Saved ${rollCode}-${rn}`);
          }
        });
      }

      saveFile();
    }
  }

  console.log("================================");
  console.log(`🎓 This run saved total: ${totalSaved}`);
  console.log("🎉 Completed.");
})();

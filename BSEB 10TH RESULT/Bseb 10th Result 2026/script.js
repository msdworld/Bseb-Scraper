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
const SCHOOL_LIST_FILE = path.join(process.cwd(), "bseb-10th-school-list-2026.json");

// Roll range
const START_ROLL = 2600001;
const END_ROLL = 2600003;

// SPEED
const CONCURRENCY = 200;
const BATCH_SIZE = 999;

// =============================
const API_URL = "https://resultapi.biharboardonline.org/result";

// =============================
// HELPERS
// =============================
function clean(txt) {
  return String(txt || "").replace(/\s+/g, " ").trim();
}

function normalizeMarks(val) {
  if (val === null || val === undefined) return "";
  const str = String(val).trim();
  if (!str) return "";
  return String(Number(str));
}

// =============================
// SUBJECT LOGIC (UNCHANGED)
// =============================
function buildPractical(subject) {
  const projectWork = normalizeMarks(subject.project_work);
  const literacyActivity = normalizeMarks(subject.literacy_activity);
  const iaSci = normalizeMarks(subject.ia_sci);
  const practical = normalizeMarks(subject.practical);

  if (subject.sub_code === "111") {
    const parts = [];
    if (projectWork) parts.push(projectWork);
    if (literacyActivity) parts.push(literacyActivity);
    return parts.join("+");
  }

  if (subject.sub_code === "112") {
    if (iaSci) return iaSci;
  }

  if (practical) return practical;

  const parts = [];
  if (projectWork) parts.push(projectWork);
  if (literacyActivity) parts.push(literacyActivity);
  if (iaSci) parts.push(iaSci);

  return parts.join("+");
}

function formatSubjects(subjects = []) {
  return subjects.map(sub => {
    const obj = {
      subCode: clean(sub.sub_code || ""),
      subject: clean(sub.sub_name || ""),
      theory: normalizeMarks(sub.theory || ""),
      subGroupId: clean(sub.sub_group_id || ""),
      subTotal: normalizeMarks(sub.sub_total || "")
    };

    const practical = buildPractical(sub);
    if (practical) obj.practical = practical;

    if (clean(sub.sub_result)) obj.subResult = clean(sub.sub_result);
    if (clean(sub.regulation)) obj.regulation = clean(sub.regulation);
    if (clean(sub.cce)) obj.cce = clean(sub.cce);
    if (clean(sub.is_compartmental)) obj.isCompartmental = clean(sub.is_compartmental);
    if (clean(sub.is_improved_sub)) obj.isImprovedSub = clean(sub.is_improved_sub);

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

  if (clean(data.passed_under_regulation)) {
    student.passedUnderRegulation = clean(data.passed_under_regulation);
  }

  student.subjects = formatSubjects(data.subjects || []);

  return student;
}

// =============================
// 🔥 CUSTOM SAVE (SUBJECT ONE LINE)
// =============================
function saveCustomJSON(file, data) {
  const rollCodes = Object.keys(data).sort((a, b) => Number(a) - Number(b));

  let out = "{\n";

  rollCodes.forEach((rc, rc_i) => {
    out += `  "${rc}": {\n`;

    const students = data[rc];
    const rollNos = Object.keys(students).sort((a, b) => Number(a) - Number(b));

    rollNos.forEach((rn, rn_i) => {
      const student = { ...students[rn] };

      const subjects = student.subjects || [];
      delete student.subjects;

      const studentLines = JSON.stringify(student, null, 6).split("\n");

      studentLines.pop(); // remove closing }

      out += `    "${rn}": ${studentLines[0]}\n`;
      for (let i = 1; i < studentLines.length; i++) {
        out += `    ${studentLines[i]}\n`;
      }

      // 🔥 SUBJECT ONE LINE
      const subjectsStr = JSON.stringify(subjects);
      out += `      ,"subjects": ${subjectsStr}\n`;
      out += `    }`;

      if (rn_i < rollNos.length - 1) out += ",";
      out += "\n";
    });

    out += `  }`;
    if (rc_i < rollCodes.length - 1) out += ",";
    out += "\n";
  });

  out += "}\n";

  fs.writeFileSync(file, out, "utf8");
}

// =============================
// FETCH
// =============================
async function fetchResult(rc, rn) {
  try {
    const res = await axios.get(API_URL, {
      params: { roll_code: rc, roll_no: rn },
      timeout: 6000
    });

    if (!res.data || !res.data.success) return null;

    return formatStudent(res.data.data);
  } catch {
    return null;
  }
}

// =============================
// MAIN
// =============================
(async () => {
  console.log("📂 Loading school list...");

  const schoolList = JSON.parse(fs.readFileSync(SCHOOL_LIST_FILE, "utf8"));

  const rollCodes = Object.keys(schoolList)
    .filter(rc => rc.startsWith(DISTRICT_PREFIX))
    .sort((a, b) => Number(a) - Number(b));

  let output = {};

  if (fs.existsSync(OUTPUT_PATH)) {
    console.log("📂 Loading existing data...");
    output = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  }

  let totalSaved = 0;

  for (const rc of rollCodes) {
    if (!output[rc]) output[rc] = {};

    console.log(`🚀 Started ${rc} from ${START_ROLL}`);

    for (let rn = START_ROLL; rn <= END_ROLL; rn += BATCH_SIZE) {
      const batch = [];

      for (let i = rn; i < rn + BATCH_SIZE && i <= END_ROLL; i++) {
        if (!output[rc][i]) batch.push(i);
      }

      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunk = batch.slice(i, i + CONCURRENCY);

        const results = await Promise.all(
          chunk.map(r => fetchResult(rc, r))
        );

        results.forEach((res, idx) => {
          if (res) {
            const rollNo = chunk[idx];
            output[rc][rollNo] = res;
            totalSaved++;
            console.log(`✅ Saved ${rollNo}`);
          }
        });
      }
    }

    saveCustomJSON(OUTPUT_PATH, output);
  }

  console.log("================================");
  console.log(`🎓 This run saved total: ${totalSaved}`);
  console.log("🎉 Completed.");
})();

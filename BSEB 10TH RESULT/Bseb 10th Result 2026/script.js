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
const ROLLNO_START = 2600001;
const ROLLNO_END = 2600005;

// SPEED
const ROLLCODE_PARALLEL = 10;
const CONCURRENCY = 200;
const BATCH_SIZE = 999;

// =============================
const API_URL = "https://resultapi.biharboardonline.org/result";

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
// SUBJECT LOGIC (FULL)
// =============================
function buildPractical(sub) {
  const pw = normalizeMarks(sub.project_work);
  const la = normalizeMarks(sub.literacy_activity);
  const ia = normalizeMarks(sub.ia_sci);
  const pr = normalizeMarks(sub.practical);

  if (sub.sub_code === "111") {
    return [pw, la].filter(Boolean).join("+");
  }

  if (sub.sub_code === "112") {
    return ia || pr;
  }

  return pr || [pw, la, ia].filter(Boolean).join("+");
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

  if (data.passed_under_regulation) {
    student.passedUnderRegulation = clean(data.passed_under_regulation);
  }

  student.subjects = formatSubjects(data.subjects || []);

  return student;
}

// =============================
// SAVE JSON (🔥 FIXED)
// =============================
function saveCustomJSON(file, data) {
  const rollCodes = Object.keys(data).sort((a, b) => Number(a) - Number(b));

  const lines = [];
  lines.push("{");

  rollCodes.forEach((rc, rc_i) => {
    lines.push(`  "${rc}": {`);

    const students = data[rc];
    const rollNos = Object.keys(students).sort((a, b) => Number(a) - Number(b));

    rollNos.forEach((rn, rn_i) => {
      const student = { ...students[rn] };

      const subjects = student.subjects || [];
      const subjectsStr = JSON.stringify(subjects); // one-line

      delete student.subjects;

      const json = JSON.stringify(student, null, 6).split("\n");

      json.forEach((line, idx) => {
        if (idx === 0) {
          lines.push(`    "${rn}": ${line}`);
        } else if (idx === json.length - 1) {
          lines.push(`      ,"subjects": ${subjectsStr}`);
          lines.push(`    }${rn_i < rollNos.length - 1 ? "," : ""}`);
        } else {
          lines.push(`    ${line}`);
        }
      });
    });

    lines.push(`  }${rc_i < rollCodes.length - 1 ? "," : ""}`);
  });

  lines.push("}");

  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

// =============================
// FETCH RESULT
// =============================
async function fetchStudent(rollCode, rollNo) {
  try {
    const res = await client.get(API_URL, {
      params: { roll_code: rollCode, roll_no: rollNo }
    });

    if (!res.data?.success) return null;

    const data = formatStudent(res.data.data);

    if (!data.studentName) return null;

    return data;
  } catch {
    return null;
  }
}

// =============================
// MAIN
// =============================
(async () => {
  console.log("📂 Loading existing data...");

  let output = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    output = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  }

  const schoolList = JSON.parse(fs.readFileSync(SCHOOL_LIST_FILE, "utf8"));

  const rollCodes = Object.keys(schoolList)
    .filter(rc => rc.startsWith(DISTRICT_PREFIX))
    .sort((a, b) => Number(a) - Number(b));

  let totalSaved = 0;

  for (let i = 0; i < rollCodes.length; i += ROLLCODE_PARALLEL) {
    const chunk = rollCodes.slice(i, i + ROLLCODE_PARALLEL);

    await Promise.all(chunk.map(async rc => {
      if (!output[rc]) output[rc] = {};

      console.log(`🚀 Started ${rc} from ${ROLLNO_START}`);

      let saved = 0;

      for (let rn = ROLLNO_START; rn <= ROLLNO_END; rn += BATCH_SIZE) {
        const batch = [];

        for (let j = rn; j < rn + BATCH_SIZE && j <= ROLLNO_END; j++) {
          batch.push(j);
        }

        for (let k = 0; k < batch.length; k += CONCURRENCY) {
          const sub = batch.slice(k, k + CONCURRENCY);

          const results = await Promise.all(
            sub.map(n => fetchStudent(rc, n))
          );

          results.forEach((res, idx) => {
            const rollNo = sub[idx];

            if (res && !output[rc][rollNo]) {
              output[rc][rollNo] = res;
              saved++;
              totalSaved++;

              console.log(`Saved ${rollNo}`);
            }
          });
        }
      }

      console.log(`${rc} -> ${saved} saved`);
    }));

    saveCustomJSON(OUTPUT_PATH, output);

    console.log("💾 Saved progress...");
  }

  console.log("================================");
  console.log(`🎓 This run saved total: ${totalSaved}`);
  console.log("🎉 Completed.");
})();

const axios = require("axios");
const fs = require("fs");
const path = require("path");

// =============================
// CONFIG (EDIT EVERY RUN)
// =============================
const DISTRICT_PREFIX = "92";
const OUTPUT_FILE = "siwan-92-bseb-10th-full-result-2026.json";

// =============================
const SCHOOL_LIST_FILE = path.resolve(process.cwd(), "bseb-10th-school-list-2026.json");
const OUTPUT_PATH = path.join(__dirname, OUTPUT_FILE);

const START_ROLL = 2600001;
const END_ROLL = 2600999;

// SPEED
const CONCURRENCY = 120;
const BATCH_SIZE = 100;

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
const clean = v => String(v || "").trim();
const num = v => (v ? String(Number(v)) : "");

// =============================
// SUBJECT FORMATTER (KEEP YOUR LOGIC)
// =============================
function buildPractical(s) {
  const pw = num(s.project_work);
  const la = num(s.literacy_activity);
  const sci = num(s.ia_sci);
  const pr = num(s.practical);

  if (s.sub_code === "111") return [pw, la].filter(Boolean).join("+");
  if (s.sub_code === "112") return sci || pr;

  return pr || [pw, la, sci].filter(Boolean).join("+");
}

function formatSubjects(arr = []) {
  return arr.map(s => {
    const obj = {
      subCode: clean(s.sub_code),
      subject: clean(s.sub_name),
      theory: num(s.theory),
      subGroupId: clean(s.sub_group_id),
      subTotal: num(s.sub_total)
    };

    const p = buildPractical(s);
    if (p) obj.practical = p;
    if (s.sub_result) obj.subResult = clean(s.sub_result);

    return obj;
  });
}

// =============================
// STUDENT FORMAT
// =============================
function formatStudent(d) {
  return {
    studentName: clean(d.name),
    fatherName: clean(d.father_name),
    regNumber: clean(d.reg_no),
    BSEBUniqueId: clean(d.bseb_id),
    schoolName: clean(d.school_name),
    rollCode: clean(d.roll_code),
    rollNo: clean(d.roll_no),
    examType: clean(d.exam_type),
    totalMarks: num(d.total),
    division: clean(d.division),
    passedUnderRegulation: clean(d.passed_under_regulation),
    subjects: formatSubjects(d.subjects)
  };
}

// =============================
// SAVE FORMAT (🔥 EXACT MATCH)
// =============================
function saveJSON(file, data) {
  const rcList = Object.keys(data).sort((a, b) => a - b);

  const out = [];
  out.push("{");

  rcList.forEach((rc, i) => {
    out.push(`  "${rc}": {`);

    const students = data[rc];
    const rnList = Object.keys(students).sort((a, b) => a - b);

    rnList.forEach((rn, j) => {
      const st = students[rn];

      const subjects = st.subjects;
      const subjectsStr = JSON.stringify(subjects);

      const { subjects: _, ...rest } = st;
      const base = JSON.stringify(rest, null, 6).split("\n");

      base.forEach((line, idx) => {
        if (idx === 0) {
          out.push(`    "${rn}": ${line}`);
        } else {
          out.push(`    ${line}`);
        }
      });

      // 👇 SUBJECTS ONE PER LINE
      out.push(`      ,"subjects": [`);
      subjects.forEach((sub, k) => {
        const line = JSON.stringify(sub);
        out.push(`        ${line}${k < subjects.length - 1 ? "," : ""}`);
      });
      out.push(`      ]`);

      out.push(`    }${j < rnList.length - 1 ? "," : ""}`);
    });

    out.push(`  }${i < rcList.length - 1 ? "," : ""}`);
  });

  out.push("}");

  fs.writeFileSync(file, out.join("\n"));
}

// =============================
// FETCH
// =============================
async function fetchResult(rc, rn) {
  try {
    const res = await client.get("https://resultapi.biharboardonline.org/result", {
      params: { roll_code: rc, roll_no: rn }
    });

    if (!res.data?.success) return null;

    return formatStudent(res.data.data);
  } catch {
    return null;
  }
}

// =============================
// MAIN
// =============================
(async () => {
  const schoolList = JSON.parse(fs.readFileSync(SCHOOL_LIST_FILE, "utf8"));

  const rollCodes = Object.keys(schoolList)
    .filter(rc => rc.startsWith(DISTRICT_PREFIX))
    .sort((a, b) => a - b);

  let data = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    data = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  }

  let totalSaved = 0;

  for (const rc of rollCodes) {
    if (!data[rc]) data[rc] = {};

    console.log(`🚀 Started ${rc} from ${START_ROLL}`);

    for (let i = START_ROLL; i <= END_ROLL; i += BATCH_SIZE) {
      const batch = [];

      for (let j = i; j < i + BATCH_SIZE && j <= END_ROLL; j++) {
        if (!data[rc][j]) batch.push(j);
      }

      const results = await Promise.all(
        batch.map(rn => fetchResult(rc, rn))
      );

      results.forEach((res, idx) => {
        if (res) {
          const rn = batch[idx];
          data[rc][rn] = res;
          totalSaved++;
          console.log(`Saved ${rn}`);
        }
      });
    }

    saveJSON(OUTPUT_PATH, data);
  }

  console.log("================================");
  console.log(`🎓 This run saved total: ${totalSaved}`);
  console.log("🎉 Completed.");
})();

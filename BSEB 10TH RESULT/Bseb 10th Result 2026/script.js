
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// =============================
// 🔧 CHANGE EVERY RUN
// =============================
const DISTRICT_PREFIX = "92";
const OUTPUT_FILE_NAME = "siwan-92-bseb-10th-full-result-2026.json";

// =============================
const BASE_DIR = __dirname;
const OUTPUT_PATH = path.join(BASE_DIR, OUTPUT_FILE_NAME);
const SCHOOL_LIST_PATH = path.join(
  __dirname,
  "../../../bseb-10th-school-list-2026.json"
);

// Roll range (10th)
const START_ROLL = 2600001;
const END_ROLL = 2600005;

// =============================
let outputData = {};

// Load existing file
if (fs.existsSync(OUTPUT_PATH)) {
  console.log("📂 Loading existing data...");
  outputData = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
}

// Load school list
const schoolList = JSON.parse(
  fs.readFileSync(SCHOOL_LIST_PATH, "utf8")
);

// Filter roll codes
const rollCodes = Object.keys(schoolList)
  .filter(rc => rc.startsWith(DISTRICT_PREFIX))
  .sort((a, b) => Number(a) - Number(b));

// =============================
// 🔥 FETCH (your working logic style)
async function fetchResult(rollCode, rollNo) {
  try {
    const url = `https://result.biharboardonline.org/result?roll_code=${rollCode}&roll_no=${rollNo}`;

    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const data = res.data;

    if (!data || typeof data !== "object") return null;
    if (!data.studentName) return null;

    return data;

  } catch (e) {
    return null;
  }
}

// =============================
// ✅ FORMAT (IMPORTANT FIX HERE)
function formatStudent(student) {
  return {
    studentName: student.studentName,
    fatherName: student.fatherName,
    regNumber: student.regNumber,
    BSEBUniqueId: student.BSEBUniqueId,
    schoolName: student.schoolName,
    rollCode: student.rollCode,
    rollNo: student.rollNo,
    examType: student.examType,
    totalMarks: student.totalMarks,
    division: student.division,

    // 👇 KEY FIX: subjects single line
    subjects: (student.subjects || []).map(sub => ({
      subCode: sub.subCode,
      subject: sub.subject,
      theory: sub.theory,
      subGroupId: sub.subGroupId,
      subTotal: sub.subTotal,
      practical: sub.practical,
      subResult: sub.subResult
    }))
  };
}

// =============================
// ✅ SAVE (CORRECT FORMAT - NO MASHUP)
function saveFile() {
  const sortedRC = Object.keys(outputData).sort((a, b) => Number(a) - Number(b));

  let content = "{\n";

  sortedRC.forEach((rc, rcIndex) => {
    content += `  "${rc}": {\n`;

    const students = outputData[rc];
    const sortedRN = Object.keys(students).sort((a, b) => Number(a) - Number(b));

    sortedRN.forEach((rn, rnIndex) => {
      const student = students[rn];

      // normal JSON (NOT messing structure)
      let studentStr = JSON.stringify(student, null, 6);

      // 🔥 compress subjects to single line
      studentStr = studentStr.replace(
        /"subjects": \[\s*([\s\S]*?)\s*\]/,
        (match) => {
          const arr = student.subjects || [];
          return `"subjects": ${JSON.stringify(arr)}`;
        }
      );

      const lines = studentStr.split("\n");

      lines.forEach((line, i) => {
        if (i === 0) {
          content += `    "${rn}": ${line}\n`;
        } else {
          content += `    ${line}\n`;
        }
      });

      if (rnIndex < sortedRN.length - 1) {
        content += ",\n";
      } else {
        content += "\n";
      }
    });

    content += "  }";
    if (rcIndex < sortedRC.length - 1) content += ",";
    content += "\n";
  });

  content += "}\n";

  fs.writeFileSync(OUTPUT_PATH, content);
}

// =============================
(async () => {
  let totalSaved = 0;

  for (const rollCode of rollCodes) {
    console.log(`🚀 Started ${rollCode} from ${START_ROLL}`);

    if (!outputData[rollCode]) {
      outputData[rollCode] = {};
    }

    for (let rollNo = START_ROLL; rollNo <= END_ROLL; rollNo++) {

      // skip duplicate
      if (outputData[rollCode][rollNo]) continue;

      const data = await fetchResult(rollCode, rollNo);

      if (data) {
        const formatted = formatStudent(data);

        outputData[rollCode][rollNo] = formatted;

        totalSaved++;
        console.log(`✅ Saved ${rollNo}`);
      }
    }

    // save after each rollCode (safe)
    saveFile();
  }

  console.log("================================");
  console.log(`🎓 This run saved total: ${totalSaved}`);
  console.log("🎉 Completed.");
})();

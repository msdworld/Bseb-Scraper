const axios = require("axios");
const fs = require("fs");
const zlib = require("zlib");

// ===============================
// CONFIG
// ===============================
const API_URL = "https://resultapi.biharboardonline.org/result";

const SCHOOL_LIST_FILE = "bseb-10th-school-list-2026.json";
const OUTPUT_JSON = "bseb-10th-full-result-2026.json";
const OUTPUT_GZ = "bseb-10th-full-result-2026.json.gz";

// Roll number range per roll code
const ROLLNO_START = 2600001;
const ROLLNO_END = 2600999;

// SPEED (Optimized for performance without getting IP banned)
const ROLLCODE_PARALLEL = 10; 
const CONCURRENCY = 900;      
const BATCH_SIZE = 100;
const REQUEST_TIMEOUT = 8000;

// SAVE THRESHOLD
const SAVE_EVERY_VALID_RESULTS = 300;

// ===============================
// SPLIT RANGE (MANUAL CONTROL)
// ===============================
const START_INDEX = 5050;
const END_INDEX = 7000;

// ===============================
// AXIOS CLIENT
// ===============================
const client = axios.create({
    timeout: REQUEST_TIMEOUT,
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
        "Referer": "https://result.biharboardonline.org/",
        "Origin": "https://result.biharboardonline.org"
    }
});

// ===============================
// HELPERS
// ===============================
function clean(txt) { return String(txt || "").replace(/\s+/g, " ").trim(); }

function normalizeMarks(val) {
    if (val === null || val === undefined) return "";
    const str = String(val).trim();
    return str ? String(Number(str)) : "";
}

function loadJSON(file, fallback = {}) {
    if (!fs.existsSync(file)) return fallback;
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function tryLoadFromGZ() {
    if (!fs.existsSync(OUTPUT_GZ)) return {};
    try {
        const gzRaw = fs.readFileSync(OUTPUT_GZ);
        const jsonRaw = zlib.gunzipSync(gzRaw).toString("utf8");
        return JSON.parse(jsonRaw);
    } catch { return {}; }
}

function loadSchoolRollCodes() {
    const raw = loadJSON(SCHOOL_LIST_FILE, {});
    return Object.keys(raw).filter(code => /^\d+$/.test(code)).sort((a, b) => Number(a) - Number(b));
}

function countTotalStudentsSaved(fullResults) {
    let total = 0;
    for (const rollCode of Object.keys(fullResults)) {
        total += Object.keys(fullResults[rollCode] || {}).length;
    }
    return total;
}

// ===============================
// STREAMING SAVE (PREVENTS RANGEERROR)
// ===============================
function saveCustomJSON(file, data) {
    // This function writes the object school-by-school so it never crashes
    const stream = fs.createWriteStream(file);
    stream.write('{\n');
    const keys = Object.keys(data);
    keys.forEach((rollCode, index) => {
        const isLast = index === keys.length - 1;
        const block = `  "${rollCode}": ${JSON.stringify(data[rollCode])}${isLast ? '' : ','}\n`;
        stream.write(block);
    });
    stream.write('}');
    stream.end();

    stream.on('finish', () => {
        // Only compress to GZ once the main file is written
        const raw = fs.readFileSync(file);
        const gz = zlib.gzipSync(raw, { level: 9 });
        fs.writeFileSync(OUTPUT_GZ, gz);
    });
}

// ===============================
// SUBJECT FORMATTER
// ===============================
function buildPractical(subject) {
    const projectWork = normalizeMarks(subject.project_work);
    const literacyActivity = normalizeMarks(subject.literacy_activity);
    const iaSci = normalizeMarks(subject.ia_sci);
    const practical = normalizeMarks(subject.practical);

    if (subject.sub_code === "111") {
        return [projectWork, literacyActivity].filter(Boolean).join("+");
    }
    if (subject.sub_code === "112") return iaSci || "";
    if (practical) return practical;
    return [projectWork, literacyActivity, iaSci].filter(Boolean).join("+");
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
        if (sub.regulation) obj.regulation = clean(sub.regulation);
        return obj;
    });
}

// ===============================
// RESULT FORMATTER
// ===============================
function formatStudent(data) {
    return {
        studentName: clean(data.name),
        fatherName: clean(data.father_name),
        regNumber: clean(data.reg_no),
        BSEBUniqueId: clean(data.bseb_id),
        schoolName: clean(data.school_name),
        rollCode: clean(data.roll_code),
        rollNo: clean(data.roll_no),
        examType: clean(data.exam_type),
        totalMarks: normalizeMarks(data.total),
        division: clean(data.division),
        subjects: formatSubjects(data.subjects || [])
    };
}

// ===============================
// FETCH LOGIC
// ===============================
async function fetchStudentResult(rollCode, rollNo) {
    try {
        const res = await client.get(API_URL, { params: { roll_code: String(rollCode), roll_no: String(rollNo) } });
        if (!res.data?.success || !res.data?.data) return { valid: false };
        const result = formatStudent(res.data.data);
        return (result.studentName && result.rollCode === String(rollCode)) ? { valid: true, data: result } : { valid: false };
    } catch { return { valid: false }; }
}

const saveState = {
    fullResults: {},
    totalStudentsSaved: 0,
    unsavedValidCount: 0,
    firstEverStudent: null,
    firstThisRunStudent: null,
    lastThisRunStudent: null
};

// ===============================
// PROCESSOR
// ===============================
async function processRollCode(rollCode) {
    if (!saveState.fullResults[rollCode]) saveState.fullResults[rollCode] = {};
    let currentRollNo = ROLLNO_START;
    let savedInThisRollCode = 0;

    while (currentRollNo <= ROLLNO_END) {
        const batchEnd = Math.min(currentRollNo + BATCH_SIZE - 1, ROLLNO_END);
        const batchRollNos = Array.from({length: batchEnd - currentRollNo + 1}, (_, i) => currentRollNo + i);

        for (let i = 0; i < batchRollNos.length; i += CONCURRENCY) {
            const chunk = batchRollNos.slice(i, i + CONCURRENCY);
            const results = await Promise.all(chunk.map(rn => fetchStudentResult(rollCode, rn)));

            results.forEach((result, idx) => {
                const rn = chunk[idx];
                if (result.valid && !saveState.fullResults[rollCode][rn]) {
                    saveState.fullResults[rollCode][rn] = result.data;
                    saveState.unsavedValidCount++;
                    saveState.totalStudentsSaved++;
                    savedInThisRollCode++;
                    if (!saveState.firstThisRunStudent) saveState.firstThisRunStudent = result.data;
                    saveState.lastThisRunStudent = result.data;
                }
            });

            if (saveState.unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
                saveCustomJSON(OUTPUT_JSON, saveState.fullResults);
                console.log(`💾 Progress Auto-Saved | Total Students: ${saveState.totalStudentsSaved}`);
                saveState.unsavedValidCount = 0;
            }
        }
        currentRollNo = batchEnd + 1;
    }
    console.log(`✅ [${rollCode}] Found ${savedInThisRollCode} students`);
    return { rollCode, newSaved: savedInThisRollCode };
}

// ===============================
// MAIN
// ===============================
(async () => {
    const allRollCodes = loadSchoolRollCodes();
    const selectedRollCodes = allRollCodes.slice(START_INDEX, END_INDEX + 1);

    if (!selectedRollCodes.length) return console.log("❌ No roll codes in range.");

    let loadedData = tryLoadFromGZ();
    if (!Object.keys(loadedData).length) loadedData = loadJSON(OUTPUT_JSON, {});

    saveState.fullResults = loadedData;
    saveState.totalStudentsSaved = countTotalStudentsSaved(saveState.fullResults);

    console.log(`🚀 SCRAPER STARTED | Split: ${START_INDEX}-${END_INDEX}`);

    for (let i = 0; i < selectedRollCodes.length; i += ROLLCODE_PARALLEL) {
        const chunk = selectedRollCodes.slice(i, i + ROLLCODE_PARALLEL);
        await Promise.all(chunk.map(rc => processRollCode(rc)));
        saveCustomJSON(OUTPUT_JSON, saveState.fullResults);
        console.log(`📦 Group Saved | Total: ${saveState.totalStudentsSaved}`);
    }

    saveCustomJSON(OUTPUT_JSON, saveState.fullResults);
    console.log(`\n🎉 DONE! Total Students: ${saveState.totalStudentsSaved}`);
})();

const axios = require("axios");
const cheerio = require("cheerio");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";
const SHOW_RESULT_URL = "https://interbiharboard.com/Result/ShowResult";

// ===============================
// TEST CONFIG
// ===============================
const TEST_ROLL_CODE = "16157";
const TEST_ROLLNO_START = 26010001;
const TEST_ROLLNO_END = 26010030;
const REQUEST_TIMEOUT = 10000;

// ===============================
// AXIOS CLIENT
// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 0,
  validateStatus: () => true,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1"
  }
});

// ===============================
// HELPERS
// ===============================
function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function detectAdditionalSection(text) {
  const t = clean(text).toLowerCase();
  if (t.includes("additional") || t.includes("अतिरिक्त")) {
    return clean(text);
  }
  return null;
}

function extractRequestVerificationToken(html) {
  const $ = cheerio.load(html);
  return clean($('input[name="__RequestVerificationToken"]').val() || "");
}

function mergeCookies(oldCookieHeader, newSetCookies = []) {
  const jar = {};

  function addCookieString(str) {
    if (!str) return;
    str.split(";").forEach(part => {
      const p = part.trim();
      if (!p.includes("=")) return;
      const [k, ...rest] = p.split("=");
      const v = rest.join("=");
      if (k && v !== undefined) jar[k.trim()] = v.trim();
    });
  }

  addCookieString(oldCookieHeader);

  newSetCookies.forEach(c => {
    const first = c.split(";")[0];
    addCookieString(first);
  });

  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ===============================
// SUBJECT PARSER
// ===============================
function parseSubjects($) {
  const subjects = [];
  let marksTableFound = false;
  let currentAdditionalSection = null;

  $("table").each((_, table) => {
    if (marksTableFound) return;

    const rows = $(table).find("tr");
    if (rows.length < 3) return;

    const row1 = [];
    const row2 = [];

    $(rows[0]).find("td,th").each((_, cell) => row1.push(clean($(cell).text())));
    $(rows[1]).find("td,th").each((_, cell) => row2.push(clean($(cell).text())));

    const row1Text = row1.join(" ").toLowerCase();

    const isMarksTable =
      row1Text.includes("subject") &&
      row1Text.includes("full marks") &&
      row1Text.includes("pass marks") &&
      row1Text.includes("theory") &&
      row1Text.includes("subject total");

    if (!isMarksTable) return;
    marksTableFound = true;

    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      const cells = [];
      $(row).find("td,th").each((_, cell) => cells.push(clean($(cell).text())));
      if (!cells.length) continue;

      if (cells.length === 1) {
        const extraLabel = detectAdditionalSection(cells[0]);
        currentAdditionalSection = extraLabel;
        continue;
      }

      if (cells.length < 5) continue;

      const subjectName = clean(cells[0]);
      if (!subjectName) continue;

      const obj = {
        subject: subjectName,
        FMarks: clean(cells[1] || ""),
        PMarks: clean(cells[2] || ""),
        theory: clean(cells[3] || ""),
        subTotal: clean(cells[cells.length - 1] || "")
      };

      if (cells[4]) obj.practical = clean(cells[4] || "");
      if (cells[5]) obj.regulationTheory = clean(cells[5] || "");
      if (cells[6]) obj.regulationPractical = clean(cells[6] || "");

      if (currentAdditionalSection) obj.extra = currentAdditionalSection;

      subjects.push(obj);
    }
  });

  return subjects;
}

// ===============================
// RESULT EXTRACTION
// ===============================
function extractKeyValues($) {
  const data = {};

  $("table tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length === 2) {
      const key = clean($(tds[0]).text()).replace(/:$/, "");
      const value = clean($(tds[1]).text());
      if (key && value) data[key] = value;
    }
  });

  return data;
}

function extractFullResult(html) {
  const $ = cheerio.load(html);
  const kv = extractKeyValues($);
  const subjects = parseSubjects($);

  return {
    studentName: kv["Student's Name"] || kv["Student Name"] || null,
    fatherName: kv["Father's Name"] || kv["Father Name"] || null,
    regNumber: kv["Registration Number"] || null,
    BSEBUniqueId: kv["BSEB Unique Id"] || null,
    schoolName: kv["School/College Name"] || kv["College Name"] || null,
    rollCode: kv["Roll Code"] || null,
    rollNo: kv["Roll Number"] || null,
    stream: kv["Faculty"] || kv["Stream"] || null,
    totalMarks: kv["Aggregate Marks"] || kv["Total Marks"] || null,
    Division: kv["Result/Division"] || kv["Division"] || null,
    subjects
  };
}

// ===============================
// SESSION FETCH
// ===============================
async function getSessionData() {
  const res = await client.get(BASE_URL);

  const html = res.data;
  const rawCookies = res.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");
  const requestVerificationToken = extractRequestVerificationToken(html);

  if (!requestVerificationToken) {
    throw new Error("Could not fetch RequestVerificationToken");
  }

  return {
    cookieHeader,
    requestVerificationToken
  };
}

// ===============================
// FETCH ONE RESULT
// ===============================
async function fetchStudentResult(rollCode, rollNo) {
  try {
    const sessionData = await getSessionData();

    const payload = new URLSearchParams();
    payload.append("rollcode", String(rollCode));
    payload.append("rollno", String(rollNo));
    payload.append("captcha", generateCaptcha());
    payload.append("__RequestVerificationToken", sessionData.requestVerificationToken);

    const postRes = await client.post(POST_URL, payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": sessionData.cookieHeader,
        "Referer": BASE_URL,
        "Origin": "https://interbiharboard.com"
      }
    });

    let cookieHeader = mergeCookies(
      sessionData.cookieHeader,
      postRes.headers["set-cookie"] || []
    );

    let resultHtml = "";

    if (postRes.status >= 300 && postRes.status < 400 && postRes.headers.location) {
      const location = postRes.headers.location.startsWith("http")
        ? postRes.headers.location
        : `https://interbiharboard.com${postRes.headers.location}`;

      const followRes = await client.get(location, {
        headers: {
          "Cookie": cookieHeader,
          "Referer": POST_URL
        },
        maxRedirects: 5
      });

      resultHtml = followRes.data;
      cookieHeader = mergeCookies(cookieHeader, followRes.headers["set-cookie"] || []);
    } else {
      resultHtml = postRes.data;
    }

    const lower = String(resultHtml || "").toLowerCase();

    const looksLikeFormAgain =
      lower.includes("enter roll code") &&
      lower.includes("enter roll number") &&
      lower.includes("view result");

    if (looksLikeFormAgain) {
      const showRes = await client.get(SHOW_RESULT_URL, {
        headers: {
          "Cookie": cookieHeader,
          "Referer": POST_URL
        },
        maxRedirects: 5
      });

      resultHtml = showRes.data;
    }

    const htmlLower = String(resultHtml || "").toLowerCase();

    if (
      htmlLower.includes("invalid") ||
      htmlLower.includes("no record") ||
      htmlLower.includes("not found") ||
      htmlLower.includes("incorrect captcha")
    ) {
      return { valid: false };
    }

    const result = extractFullResult(resultHtml);

    if (
      result.studentName &&
      result.rollCode === String(rollCode) &&
      result.rollNo === String(rollNo)
    ) {
      return { valid: true, data: result };
    }

    return { valid: false };
  } catch (err) {
    return {
      valid: false,
      error: err.message || "Unknown error"
    };
  }
}

// ===============================
// MAIN TEST
// ===============================
(async () => {
  console.log("======================================");
  console.log("🧪 BSEB SINGLE ROLL CODE TEST STARTED");
  console.log("======================================");
  console.log(`🎯 Roll Code: ${TEST_ROLL_CODE}`);
  console.log(`🔢 Checking Roll Numbers: ${TEST_ROLLNO_START} to ${TEST_ROLLNO_END}`);
  console.log("");

  let validCount = 0;

  for (let rollNo = TEST_ROLLNO_START; rollNo <= TEST_ROLLNO_END; rollNo++) {
    console.log(`🔍 Checking: ${TEST_ROLL_CODE} / ${rollNo}`);

    const result = await fetchStudentResult(TEST_ROLL_CODE, rollNo);

    if (result.valid) {
      validCount++;
      console.log(`✅ VALID: ${rollNo}`);
      console.log("📘 RESULT JSON:");
      console.log(JSON.stringify(result.data, null, 2));
      console.log("--------------------------------------------------");
    } else {
      console.log(`❌ INVALID: ${rollNo}${result.error ? ` | ${result.error}` : ""}`);
    }
  }

  console.log("");
  console.log("======================================");
  console.log("🎉 TEST COMPLETED");
  console.log(`📦 Total Valid Found: ${validCount}`);
  console.log("======================================");
})();

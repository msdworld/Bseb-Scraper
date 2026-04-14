const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ===============================
// PATH
// ===============================
const ROOT_DIR = path.resolve(__dirname, "..", "..");

// ===============================
// URLS
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";
const SHOW_RESULT_URL = "https://interbiharboard.com/Result/ShowResult";

// ===============================
// FILES (ROOT)
// ===============================
const COLLEGE_FILE = path.join(ROOT_DIR, "bseb-12th-college-list-2026.json");
const OUTPUT_FILE = path.join(ROOT_DIR, "bseb-12th-roll-code-list.json");

// ===============================
// SMART TEST RANGES (ONLY 50)
// ===============================
const RANGES = [
  [26010001, 26010050],
  [26020001, 26020050],
  [26030001, 26030050],
  [26040001, 26040050],
  [26050001, 26050050],
  [26060001, 26060050],
  [26070001, 26070050],
  [26080001, 26080050],
  [26090001, 26090050]
];

// ===============================
// AXIOS
// ===============================
const client = axios.create({
  timeout: 5000,
  maxRedirects: 0,
  validateStatus: () => true,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "*/*",
    "Content-Type": "application/x-www-form-urlencoded"
  }
});

// ===============================
// HELPERS
// ===============================
function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

function loadJSON(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function extractToken(html) {
  const $ = cheerio.load(html);
  return clean($('input[name="__RequestVerificationToken"]').val() || "");
}

function mergeCookies(oldCookie, newSetCookies = []) {
  const jar = {};

  function add(str) {
    if (!str) return;
    str.split(";").forEach(p => {
      const [k, ...rest] = p.trim().split("=");
      if (k && rest.length) jar[k] = rest.join("=");
    });
  }

  add(oldCookie);
  newSetCookies.forEach(c => add(c.split(";")[0]));

  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ===============================
// EXTRACT SCHOOL NAME (STRICT)
// ===============================
function extractSchoolName(html) {
  const $ = cheerio.load(html);

  let school = "";

  $("table tr").each((_, row) => {
    const tds = $(row).find("td");

    if (tds.length === 2) {
      const key = clean($(tds[0]).text()).toLowerCase();
      const val = clean($(tds[1]).text());

      if (
        key.includes("school") ||
        key.includes("college")
      ) {
        school = val;
      }
    }
  });

  return school;
}

// ===============================
// SESSION
// ===============================
async function getSession() {
  const res = await client.get(BASE_URL);

  const cookies = (res.headers["set-cookie"] || [])
    .map(c => c.split(";")[0])
    .join("; ");

  const token = extractToken(res.data);

  if (!token) throw new Error("Token failed");

  return { cookies, token };
}

// ===============================
// FETCH VALID RESULT (REAL)
// ===============================
async function fetchResult(rollCode, rollNo, session) {
  try {
    const payload = new URLSearchParams();
    payload.append("rollcode", rollCode);
    payload.append("rollno", rollNo);
    payload.append("captcha", generateCaptcha());
    payload.append("__RequestVerificationToken", session.token);

    const postRes = await client.post(POST_URL, payload.toString(), {
      headers: {
        Cookie: session.cookies,
        Referer: BASE_URL,
        Origin: BASE_URL
      }
    });

    let cookie = mergeCookies(session.cookies, postRes.headers["set-cookie"]);

    let html = "";

    // redirect case
    if (postRes.status >= 300 && postRes.status < 400 && postRes.headers.location) {
      const follow = await client.get(
        "https://interbiharboard.com" + postRes.headers.location,
        { headers: { Cookie: cookie } }
      );
      html = follow.data;
    } else {
      html = postRes.data;
    }

    const lower = String(html).toLowerCase();

    // fallback ShowResult
    if (
      lower.includes("enter roll code") &&
      lower.includes("view result")
    ) {
      const showRes = await client.get(SHOW_RESULT_URL, {
        headers: { Cookie: cookie }
      });
      html = showRes.data;
    }

    const htmlLower = String(html).toLowerCase();

    if (
      htmlLower.includes("invalid") ||
      htmlLower.includes("not found") ||
      htmlLower.includes("no record")
    ) {
      return null;
    }

    const schoolName = extractSchoolName(html);

    if (schoolName && schoolName.length > 5) {
      return schoolName;
    }

    return null;

  } catch {
    return null;
  }
}

// ===============================
// MAIN
// ===============================
(async () => {
  console.log("🚀 ROLL CODE FINDER STARTED");

  const collegeList = loadJSON(COLLEGE_FILE);
  const outputData = loadJSON(OUTPUT_FILE);

  const existing = new Set(Object.keys(collegeList));
  const discovered = new Set(Object.keys(outputData));

  console.log(`📚 Existing: ${existing.size}`);
  console.log(`🆕 Already Found: ${discovered.size}`);

  let session = await getSession();

  let found = 0;

  for (let rc = 11001; rc <= 99999; rc++) {
    const rollCode = String(rc);

    if (existing.has(rollCode) || discovered.has(rollCode)) continue;

    for (const [start, end] of RANGES) {

      let foundHere = false;

      for (let rn = start; rn <= end; rn++) {
        const school = await fetchResult(rollCode, rn, session);

        if (school) {
          outputData[rollCode] = school;
          discovered.add(rollCode);

          console.log(`✅ ${rollCode} | ${school}`);

          saveJSON(OUTPUT_FILE, outputData);

          found++;
          foundHere = true;
          break;
        }
      }

      if (foundHere) break;
    }
  }

  console.log("🎉 DONE");
  console.log(`🆕 Total New Roll Codes: ${found}`);
})();

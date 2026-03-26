const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/Default.html";
const POST_URL = "https://interbiharboard.com/Result.aspx";

const rollCode = "42104";
const rollNumber = "26010031";

// ===============================
// AXIOS INSTANCE
// ===============================
const client = axios.create({
  timeout: 30000,
  maxRedirects: 5,
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

function getHidden($, id) {
  return clean($(`#${id}`).val() || "");
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function extractResultData(html) {
  const $ = cheerio.load(html);

  const data = {
    studentName: null,
    fatherName: null,
    motherName: null,
    schoolName: null,
    rollCode: null,
    rollNo: null,
    bsebUniqueId: null
  };

  $("table tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length === 2) {
      const key = clean($(tds[0]).text()).toLowerCase();
      const value = clean($(tds[1]).text());

      if (key.includes("student")) data.studentName = value;
      if (key.includes("father")) data.fatherName = value;
      if (key.includes("mother")) data.motherName = value;
      if (key.includes("school") || key.includes("college")) data.schoolName = value;
      if (key === "roll code") data.rollCode = value;
      if (key === "roll number") data.rollNo = value;
      if (key.includes("unique")) data.bsebUniqueId = value;
    }
  });

  return data;
}

// ===============================
// MAIN
// ===============================
(async () => {
  try {
    console.log("🚀 STEP 1: Fetching form page...");

    // --------------------------------
    // 1. GET DEFAULT PAGE
    // --------------------------------
    const getRes = await client.get(BASE_URL);

    console.log("📌 GET Status:", getRes.status);

    const html1 = getRes.data;
    const $ = cheerio.load(html1);

    // Collect cookies
    const rawCookies = getRes.headers["set-cookie"] || [];
    const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

    // Extract ASP.NET hidden fields
    const VIEWSTATE = getHidden($, "__VIEWSTATE");
    const VIEWSTATEGENERATOR = getHidden($, "__VIEWSTATEGENERATOR");
    const EVENTVALIDATION = getHidden($, "__EVENTVALIDATION");

    console.log("✅ Hidden fields:");
    console.log({
      VIEWSTATE: !!VIEWSTATE,
      VIEWSTATEGENERATOR: !!VIEWSTATEGENERATOR,
      EVENTVALIDATION: !!EVENTVALIDATION
    });

    if (!VIEWSTATE || !EVENTVALIDATION) {
      console.log("❌ Failed to extract hidden fields.");
      fs.writeFileSync("debug-form.html", html1);
      console.log("📝 Saved debug-form.html");
      return;
    }

    // --------------------------------
    // 2. GENERATE CAPTCHA (client-side only)
    // --------------------------------
    const captchaValue = generateCaptcha();
    console.log("🔐 Using Captcha:", captchaValue);

    // --------------------------------
    // 3. BUILD POST PAYLOAD
    // --------------------------------
    const payload = new URLSearchParams();
    payload.append("__EVENTTARGET", "");
    payload.append("__EVENTARGUMENT", "");
    payload.append("__VIEWSTATE", VIEWSTATE);
    payload.append("__VIEWSTATEGENERATOR", VIEWSTATEGENERATOR);
    payload.append("__EVENTVALIDATION", EVENTVALIDATION);
    payload.append("mobile", rollCode);
    payload.append("password", rollNumber);
    payload.append("captchaInput", captchaValue);
    payload.append("btn_login", "View Result");

    console.log("🚀 STEP 2: Sending POST request...");

    // --------------------------------
    // 4. POST RESULT REQUEST
    // --------------------------------
    const postRes = await client.post(POST_URL, payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookieHeader,
        "Referer": BASE_URL,
        "Origin": "https://interbiharboard.com"
      }
    });

    console.log("📌 POST Status:", postRes.status);
    console.log("📌 Final URL:", postRes.request?.res?.responseUrl || POST_URL);

    const html2 = postRes.data;
    fs.writeFileSync("debug-result.html", html2);

    // --------------------------------
    // 5. EXTRACT RESULT
    // --------------------------------
    const result = extractResultData(html2);

    console.log("\n=========== RESULT JSON ===========\n");
    console.log(JSON.stringify(result, null, 2));

    // --------------------------------
    // 6. VALID / INVALID
    // --------------------------------
    if (result.schoolName && result.rollCode && result.rollNo) {
      console.log("\n✅ DIRECT POST WORKED!");
    } else {
      console.log("\n❌ DIRECT POST DID NOT RETURN VALID RESULT");
      console.log("📝 Check debug-result.html");
    }

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    if (err.code) console.error("📌 ERROR CODE:", err.code);
    if (err.response) console.error("📌 RESPONSE STATUS:", err.response.status);
  }
})();

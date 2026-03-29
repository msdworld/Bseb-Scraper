const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";

const TEST_ROLL_CODE = "42104";
const TEST_ROLL_NO = "26010021";
const TEST_CAPTCHA = "123456";

const REQUEST_TIMEOUT = 15000;

// ===============================
// AXIOS CLIENT
// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
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

function getHidden($, name) {
  return clean($(`input[name="${name}"]`).val() || "");
}

// ===============================
// FETCH FORM PAGE
// ===============================
async function getSessionData() {
  console.log("🚀 STEP 1: Fetching form page...");

  const res = await client.get(BASE_URL);
  console.log("📌 GET Status:", res.status);

  const html = String(res.data || "");
  fs.writeFileSync("debug-default.html", html, "utf8");

  const $ = cheerio.load(html);

  const rawCookies = res.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

  const requestVerificationToken = getHidden($, "__RequestVerificationToken");

  console.log("✅ Hidden fields:");
  console.log({
    RequestVerificationToken: !!requestVerificationToken
  });

  return {
    cookieHeader,
    requestVerificationToken,
    html
  };
}

// ===============================
// POST ONE RESULT
// ===============================
async function fetchStudentResult(rollCode, rollNo, sessionData) {
  console.log("\n🚀 STEP 2: Sending POST request...");

  const payload = new URLSearchParams();
  payload.append("rollcode", String(rollCode));
  payload.append("rollno", String(rollNo));
  payload.append("captcha", TEST_CAPTCHA);
  payload.append("__RequestVerificationToken", sessionData.requestVerificationToken);

  const res = await client.post(POST_URL, payload.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": sessionData.cookieHeader,
      "Referer": BASE_URL,
      "Origin": "https://interbiharboard.com"
    }
  });

  console.log("📌 POST Status:", res.status);
  console.log("📌 Final URL:", POST_URL);

  const html = String(res.data || "");
  fs.writeFileSync("debug-result.html", html, "utf8");

  return {
    status: res.status,
    headers: res.headers,
    html
  };
}

// ===============================
// INSPECT RETURNED PAGE
// ===============================
function inspectReturnedPage(html) {
  const $ = cheerio.load(html);

  console.log("\n==============================");
  console.log("RETURNED PAGE TITLE");
  console.log("==============================");
  console.log(clean($("title").text()) || "(no title)");

  console.log("\n==============================");
  console.log("RETURNED FORMS");
  console.log("==============================");

  $("form").each((i, form) => {
    const action = $(form).attr("action") || "";
    const method = ($(form).attr("method") || "GET").toUpperCase();
    const id = $(form).attr("id") || "";
    const name = $(form).attr("name") || "";

    console.log(`\n[FORM ${i + 1}]`);
    console.log(`action: ${action}`);
    console.log(`method: ${method}`);
    console.log(`id: ${id}`);
    console.log(`name: ${name}`);
  });

  console.log("\n==============================");
  console.log("LINKS / ROUTES");
  console.log("==============================");

  $("a").each((i, a) => {
    const href = $(a).attr("href") || "";
    const text = clean($(a).text());

    if (href) {
      console.log(`${i + 1}. href="${href}" text="${text}"`);
    }
  });

  console.log("\n==============================");
  console.log("SCRIPT TAGS");
  console.log("==============================");

  $("script").each((i, el) => {
    const src = $(el).attr("src") || "";
    const inline = clean($(el).html() || "");

    console.log(`\n[SCRIPT ${i + 1}]`);
    console.log("src:", src || "(inline)");

    if (inline) {
      console.log(inline.slice(0, 1200));
      console.log("---- END PREVIEW ----");
    }
  });

  console.log("\n==============================");
  console.log("IMPORTANT TEXT MATCHES");
  console.log("==============================");

  const matches = html.match(/.{0,180}(window\.location|location\.href|location\.replace|fetch\(|axios|\/Result\/[A-Za-z0-9/_-]+|Student's Name|Roll Code|Aggregate Marks|captcha|Incorrect CAPTCHA|View Result|Please Enter Correct CAPTCHA).{0,220}/gi);

  if (matches && matches.length) {
    matches.forEach((line, i) => {
      console.log(`\n[${i + 1}] ${line}\n`);
    });
  } else {
    console.log("❌ No important route/result text found");
  }

  console.log("\n==============================");
  console.log("VISIBLE TEXT PREVIEW");
  console.log("==============================");

  const bodyText = clean($("body").text()).slice(0, 3000);
  console.log(bodyText || "(no visible text)");
}

// ===============================
// MAIN
// ===============================
(async () => {
  try {
    const sessionData = await getSessionData();
    const response = await fetchStudentResult(TEST_ROLL_CODE, TEST_ROLL_NO, sessionData);

    console.log("\n💾 Saved files:");
    console.log("- debug-default.html");
    console.log("- debug-result.html");

    inspectReturnedPage(response.html);

    console.log("\n✅ DONE");
  } catch (err) {
    console.error("\n❌ ERROR:", err.message);
    process.exit(1);
  }
})();

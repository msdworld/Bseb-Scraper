const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const FORM_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";

// PUT A KNOWN VALID STUDENT HERE
const ROLL_CODE = "13201";
const ROLL_NO = "26010021"; // change to one you know is valid

const client = axios.create({
  timeout: 15000,
  maxRedirects: 10,
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

function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function extractResultData(html) {
  const $ = cheerio.load(html);

  const allText = clean($.text());

  const data = {
    studentName: null,
    fatherName: null,
    regNumber: null,
    BSEBUniqueId: null,
    schoolName: null,
    rollCode: null,
    rollNo: null,
    stream: null,
    totalMarks: null,
    Division: null,
    subjects: []
  };

  // Try all 2-column table rows
  $("table tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length === 2) {
      const key = clean($(tds[0]).text()).replace(/:$/, "");
      const value = clean($(tds[1]).text());

      if (/student.?s name|student name/i.test(key)) data.studentName = value;
      if (/father.?s name|father name/i.test(key)) data.fatherName = value;
      if (/registration number/i.test(key)) data.regNumber = value;
      if (/bseb unique id/i.test(key)) data.BSEBUniqueId = value;
      if (/school|college name/i.test(key)) data.schoolName = value;
      if (/roll code/i.test(key)) data.rollCode = value;
      if (/roll number/i.test(key)) data.rollNo = value;
      if (/faculty|stream/i.test(key)) data.stream = value;
      if (/aggregate marks|total marks/i.test(key)) data.totalMarks = value;
      if (/result\/division|division|result/i.test(key)) data.Division = value;
    }
  });

  return {
    data,
    allText
  };
}

(async () => {
  try {
    console.log("🚀 STEP 1: Fetching form page...");
    const getRes = await client.get(FORM_URL);

    console.log("📌 GET Status:", getRes.status);

    const html1 = getRes.data;
    fs.writeFileSync("debug-default.html", html1);

    const $ = cheerio.load(html1);

    const token = clean($('input[name="__RequestVerificationToken"]').val() || "");
    const rawCookies = getRes.headers["set-cookie"] || [];
    const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

    console.log("✅ Hidden fields:");
    console.log({
      RequestVerificationToken: !!token
    });

    if (!token) {
      console.log("❌ Token not found");
      return;
    }

    console.log("\n=========== SEARCHING CAPTCHA SCRIPT ===========\n");

    const captchaMatches = html1.match(/.{0,120}(captcha|generatedCaptcha).{0,200}/gi);
    if (captchaMatches && captchaMatches.length) {
      captchaMatches.forEach((line, i) => {
        console.log(`[${i + 1}] ${line}\n`);
      });
    } else {
      console.log("❌ No captcha-related text found");
    }

    const captchaValue = generateCaptcha();
    console.log("🔐 Using Captcha:", captchaValue);

    const payload = new URLSearchParams();
    payload.append("rollcode", ROLL_CODE);
    payload.append("rollno", ROLL_NO);
    payload.append("captcha", captchaValue);
    payload.append("__RequestVerificationToken", token);

    console.log("\n🚀 STEP 2: Sending POST request...");
    console.log("📦 PAYLOAD:");
    console.log(payload.toString());

    const postRes = await client.post(POST_URL, payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookieHeader,
        "Referer": FORM_URL,
        "Origin": "https://interbiharboard.com"
      }
    });

    console.log("📌 POST Status:", postRes.status);
    console.log("📌 Final URL:", postRes.request?.res?.responseUrl || POST_URL);
    console.log("📌 Content-Type:", postRes.headers["content-type"] || "unknown");

    const html2 = String(postRes.data || "");
    fs.writeFileSync("debug-result.html", html2);

    const $$ = cheerio.load(html2);

    console.log("\n==============================");
    console.log("RETURNED PAGE TITLE");
    console.log("==============================");
    console.log(clean($$("title").text()) || "(No title)");

    console.log("\n==============================");
    console.log("RETURNED FORMS");
    console.log("==============================");
    $$("form").each((i, form) => {
      console.log(`[FORM ${i + 1}]`);
      console.log("action:", $$(form).attr("action") || "");
      console.log("method:", $$(form).attr("method") || "");
      console.log("id:", $$(form).attr("id") || "");
      console.log("name:", $$(form).attr("name") || "");
      console.log("");
    });

    console.log("\n==============================");
    console.log("LINKS / ROUTES");
    console.log("==============================");
    const links = new Set();

    $$("a, form, script").each((_, el) => {
      const href = $$(el).attr("href");
      const action = $$(el).attr("action");
      const src = $$(el).attr("src");

      [href, action, src].forEach(v => {
        if (v && /result|showresult|getresult/i.test(v)) {
          links.add(v);
        }
      });
    });

    [...links].forEach((l, i) => console.log(`${i + 1}. ${l}`));

    console.log("\n==============================");
    console.log("IMPORTANT TEXT MATCHES");
    console.log("==============================");

    const importantMatches = html2.match(/.{0,100}(student|roll code|roll number|aggregate marks|faculty|division|captcha|incorrect|showresult|getresult).{0,200}/gi);
    if (importantMatches && importantMatches.length) {
      importantMatches.slice(0, 50).forEach((line, i) => {
        console.log(`[${i + 1}] ${clean(line)}`);
      });
    } else {
      console.log("No important matches found");
    }

    console.log("\n==============================");
    console.log("VISIBLE TEXT PREVIEW");
    console.log("==============================");
    console.log(clean($$("body").text()).slice(0, 4000));

    const { data } = extractResultData(html2);

    console.log("\n📘 EXTRACTED RESULT:");
    console.log(JSON.stringify(data, null, 2));

    if (data.studentName && data.rollCode && data.rollNo) {
      console.log("\n✅ RESULT PAGE SUCCESSFULLY EXTRACTED");
    } else {
      console.log("\n❌ RESULT NOT EXTRACTED");
      console.log("📂 Check these files:");
      console.log("- debug-default.html");
      console.log("- debug-result.html");
    }

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    if (err.code) console.error("📌 ERROR CODE:", err.code);
    if (err.response) console.error("📌 RESPONSE STATUS:", err.response.status);
  }
})();

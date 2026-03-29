const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const URL = "https://interbiharboard.com/";
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

function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

(async () => {
  try {
    console.log("🚀 STEP 1: Fetching form page...");
    const res = await client.get(URL);

    console.log("📌 GET Status:", res.status);

    const html = String(res.data || "");
    fs.writeFileSync("debug-form.html", html, "utf8");

    const $ = cheerio.load(html);

    // ===============================
    // Hidden fields
    // ===============================
    const token = $('input[name="__RequestVerificationToken"]').val() || "";

    console.log("\n✅ Hidden fields:");
    console.log({
      RequestVerificationToken: !!token
    });

    // ===============================
    // Search raw HTML for captcha-related strings
    // ===============================
    console.log("\n=========== SEARCHING CAPTCHA SCRIPT ===========\n");

    const captchaMatches = html.match(/.{0,160}(captcha|generatedCaptcha|refreshCaptcha|math|sum|total|operand|security).{0,240}/gi);

    if (captchaMatches && captchaMatches.length) {
      captchaMatches.forEach((line, i) => {
        console.log(`\n[${i + 1}] ${line}\n`);
      });
    } else {
      console.log("❌ No captcha-related text found in raw HTML");
    }

    // ===============================
    // Print all script tags
    // ===============================
    console.log("\n=========== SCRIPT TAGS ===========\n");

    $("script").each((i, el) => {
      const src = $(el).attr("src") || "";
      const inline = clean($(el).html() || "");

      console.log(`\n[SCRIPT ${i + 1}]`);
      console.log("src:", src || "(inline)");

      if (inline) {
        console.log(inline.slice(0, 1500)); // only preview
        console.log("---- END PREVIEW ----");
      }
    });

    // ===============================
    // Print captcha-related elements
    // ===============================
    console.log("\n=========== CAPTCHA ELEMENTS ===========\n");

    $("*").each((i, el) => {
      const id = ($(el).attr("id") || "").toLowerCase();
      const name = ($(el).attr("name") || "").toLowerCase();
      const cls = ($(el).attr("class") || "").toLowerCase();
      const text = clean($(el).text() || "");

      const joined = `${id} ${name} ${cls} ${text}`.toLowerCase();

      if (
        joined.includes("captcha") ||
        joined.includes("security") ||
        joined.includes("total of") ||
        joined.includes("sum")
      ) {
        console.log({
          tag: el.tagName,
          id: $(el).attr("id") || "",
          name: $(el).attr("name") || "",
          class: $(el).attr("class") || "",
          text: text.slice(0, 200)
        });
      }
    });

    console.log("\n💾 Saved: debug-form.html");
    console.log("✅ Done");
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    process.exit(1);
  }
})();

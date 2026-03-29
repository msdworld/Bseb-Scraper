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

// ===============================
// HELPERS
// ===============================
function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

// ===============================
// MAIN
// ===============================
(async () => {
  try {
    const res = await client.get(URL);
    const html = String(res.data || "");
    fs.writeFileSync("debug-default.html", html, "utf8");

    console.log("🚀 FORM INSPECTION STARTED");
    console.log(`HTTP Status: ${res.status}`);

    const rawCookies = res.headers["set-cookie"] || [];
    console.log(`Cookies received: ${rawCookies.length}`);

    const $ = cheerio.load(html);

    // ===============================
    // FORMS
    // ===============================
    console.log("\n==============================");
    console.log("FORMS FOUND");
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

      console.log("\nInputs inside this form:");

      $(form).find("input, select, textarea, button").each((j, el) => {
        const tag = el.tagName;
        const type = $(el).attr("type") || "";
        const inputName = $(el).attr("name") || "";
        const inputId = $(el).attr("id") || "";
        const value = $(el).attr("value") || "";
        const placeholder = $(el).attr("placeholder") || "";

        console.log(
          `  ${j + 1}. <${tag}> type="${type}" name="${inputName}" id="${inputId}" value="${value}" placeholder="${placeholder}"`
        );
      });
    });

    // ===============================
    // HIDDEN FIELDS
    // ===============================
    console.log("\n==============================");
    console.log("HIDDEN INPUTS");
    console.log("==============================");

    $('input[type="hidden"]').each((i, el) => {
      const name = $(el).attr("name") || "";
      const id = $(el).attr("id") || "";
      const value = $(el).attr("value") || "";

      console.log(`${i + 1}. name="${name}" id="${id}" value="${value}"`);
    });

    // ===============================
    // CAPTCHA / IMAGES
    // ===============================
    console.log("\n==============================");
    console.log("IMAGES / CAPTCHA CANDIDATES");
    console.log("==============================");

    $("img").each((i, img) => {
      const src = $(img).attr("src") || "";
      const alt = $(img).attr("alt") || "";
      const id = $(img).attr("id") || "";
      const cls = $(img).attr("class") || "";

      if (
        src.toLowerCase().includes("captcha") ||
        alt.toLowerCase().includes("captcha") ||
        id.toLowerCase().includes("captcha") ||
        cls.toLowerCase().includes("captcha")
      ) {
        console.log(`${i + 1}. src="${src}" alt="${alt}" id="${id}" class="${cls}"`);
      }
    });

    // ===============================
    // BUTTONS / SUBMITS
    // ===============================
    console.log("\n==============================");
    console.log("BUTTONS / SUBMITS");
    console.log("==============================");

    $('button, input[type="submit"], input[type="button"]').each((i, el) => {
      const tag = el.tagName;
      const type = $(el).attr("type") || "";
      const name = $(el).attr("name") || "";
      const id = $(el).attr("id") || "";
      const value = $(el).attr("value") || "";
      const text = clean($(el).text());

      console.log(
        `${i + 1}. <${tag}> type="${type}" name="${name}" id="${id}" value="${value}" text="${text}"`
      );
    });

    console.log("\n💾 Saved full page as debug-default.html");
    console.log("✅ Done");
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    process.exit(1);
  }
})();

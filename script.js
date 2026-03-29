const fs = require("fs");
const cheerio = require("cheerio");

// ===============================
// CONFIG
// ===============================
const FILE = "debug-result.html";

// ===============================
// HELPERS
// ===============================
function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

// ===============================
// MAIN
// ===============================
(() => {
  if (!fs.existsSync(FILE)) {
    console.log(`❌ ${FILE} not found`);
    process.exit(1);
  }

  const html = fs.readFileSync(FILE, "utf8");
  const $ = cheerio.load(html);

  console.log("🚀 INSPECTING RETURNED RESULT PAGE...");
  console.log(`📄 File: ${FILE}`);

  // ===============================
  // PAGE TITLE
  // ===============================
  console.log("\n==============================");
  console.log("PAGE TITLE");
  console.log("==============================");
  console.log(clean($("title").text()) || "(no title)");

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
  });

  // ===============================
  // LINKS
  // ===============================
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

  // ===============================
  // IFRAME / EMBED / OBJECT
  // ===============================
  console.log("\n==============================");
  console.log("IFRAME / EMBED / OBJECT");
  console.log("==============================");

  $("iframe, embed, object").each((i, el) => {
    const tag = el.tagName;
    const src = $(el).attr("src") || $(el).attr("data") || "";
    console.log(`${i + 1}. <${tag}> src/data="${src}"`);
  });

  // ===============================
  // SCRIPT TAGS
  // ===============================
  console.log("\n==============================");
  console.log("SCRIPT TAGS");
  console.log("==============================");

  $("script").each((i, el) => {
    const src = $(el).attr("src") || "";
    const inline = clean($(el).html() || "");

    console.log(`\n[SCRIPT ${i + 1}]`);
    console.log("src:", src || "(inline)");

    if (inline) {
      console.log(inline.slice(0, 1500));
      console.log("---- END PREVIEW ----");
    }
  });

  // ===============================
  // SEARCH FOR RESULT / REDIRECT / FETCH / AJAX
  // ===============================
  console.log("\n==============================");
  console.log("SEARCHING IMPORTANT KEYWORDS");
  console.log("==============================");

  const matches = html.match(/.{0,180}(window\.location|location\.href|location\.replace|fetch\(|axios|\/Result\/[A-Za-z0-9/_-]+|Student's Name|Roll Code|Aggregate Marks|captcha|Incorrect CAPTCHA|View Result).{0,220}/gi);

  if (matches && matches.length) {
    matches.forEach((line, i) => {
      console.log(`\n[${i + 1}] ${line}\n`);
    });
  } else {
    console.log("❌ No important route/result text found");
  }

  // ===============================
  // TEXT SNIPPET
  // ===============================
  console.log("\n==============================");
  console.log("VISIBLE TEXT PREVIEW");
  console.log("==============================");

  const bodyText = clean($("body").text()).slice(0, 3000);
  console.log(bodyText || "(no visible text)");
})();

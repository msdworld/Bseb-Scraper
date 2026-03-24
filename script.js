const puppeteer = require("puppeteer");

(async () => {

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  await page.goto("http://interbiharboard.com/", {
    waitUntil: "domcontentloaded"
  });

  const rollCode = "42104";
  const rollNumber = "26010031";

  await page.type("#mobile", rollCode);
  await page.type("#password", rollNumber);

  await page.evaluate(() => {
    const cap = document.getElementById("generatedCaptcha").dataset.value;
    document.getElementById("captchaInput").value = cap;
  });

  await page.click("#btn_login");

  await page.waitForNavigation({ waitUntil: "domcontentloaded" });

  const text = await page.evaluate(() => document.body.innerText);

  console.log("\n===== RESULT =====\n");
  console.log(text.substring(0, 1000)); // only preview

  await browser.close();

})();

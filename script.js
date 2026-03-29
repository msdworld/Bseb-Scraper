import fs from "fs";

const INPUT_FILE = "bseb-12th-college-list-2026.json";

try {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ File not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT_FILE, "utf8");
  const data = JSON.parse(raw);

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    console.error("❌ JSON must be an object like: { \"12001\": \"\", \"12002\": \"\" }");
    process.exit(1);
  }

  const prefixCount = {};
  let totalValid = 0;

  for (const rollCode of Object.keys(data)) {
    const code = String(rollCode).trim();

    // only accept exactly 5 digit roll codes
    if (!/^\d{5}$/.test(code)) continue;

    const prefix = code.slice(0, 2);

    prefixCount[prefix] = (prefixCount[prefix] || 0) + 1;
    totalValid++;
  }

  const sortedPrefixes = Object.keys(prefixCount).sort((a, b) => Number(a) - Number(b));

  console.log("\n✅ Prefix-wise valid roll code count:\n");

  for (const prefix of sortedPrefixes) {
    console.log(`${prefix} - ${prefixCount[prefix]}`);
  }

  console.log(`\n📌 Total valid roll codes found: ${totalValid}`);
  console.log(`📌 Total unique prefixes found: ${sortedPrefixes.length}\n`);

} catch (err) {
  console.error("❌ Error:", err.message);
  process.exit(1);
}

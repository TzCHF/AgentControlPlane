import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function createSha256Manifest(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Provide at least one release asset path.");
  }
  return [...files]
    .map((file) => path.resolve(file))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))
    .map((file) => {
      if (!fs.existsSync(file)) throw new Error(`Release asset does not exist: ${file}`);
      if (!fs.statSync(file).isFile()) throw new Error(`Release asset is not a file: ${file}`);
      const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      return `${hash}  ${path.basename(file)}`;
    })
    .join("\n") + "\n";
}

export function main(argv = process.argv.slice(2)) {
  const outputIndex = argv.indexOf("--output");
  let output = null;
  let files = [...argv];
  if (outputIndex >= 0) {
    output = files[outputIndex + 1];
    if (!output) throw new Error("--output requires a file path.");
    files.splice(outputIndex, 2);
  }
  const manifest = createSha256Manifest(files);
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, manifest, "utf8");
    console.log(`SHA256 manifest: ${path.resolve(output)}`);
  } else {
    process.stdout.write(manifest);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
/**
 * paper-digest CLI.
 *
 * Subcommands:
 *
 *   paper-digest prompt <source> [--out <file>]
 *       Fetch the source and print the master prompt (JSON-output instructions).
 *       Use this to hand the prompt to a chat AI, which returns the digest JSON.
 *
 *   paper-digest digest <source> [--out <dir>]
 *       Full pipeline: fetch -> OpenRouter agent (JSON) -> template -> HTML.
 *
 *   paper-digest template <digest.json> [--out <dir>]
 *       Take an already-written digest JSON and render it into the HTML template.
 *
 * source: an arXiv id/link, a URL, raw HTML text, or a local PDF path.
 */

import { resolve } from "./fetch.js";
import { buildMasterPrompt } from "./prompt.js";
import { digestSource, loadConfig, createClient } from "./digest.js";
import { renderString, renderFile, outputFilenameBase, sanitize, shortenedTitle, extractYear, venueAbbv } from "./template.js";
import { extractJson } from "./llm.js";
import { readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const DEFAULT_OUT = "outputs";

function parseArgs(argv) {
  const args = argv.slice(2);
  const subcommand = args[0];
  const rest = args.slice(1);
  let out = DEFAULT_OUT;
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out" || rest[i] === "-o") {
      out = rest[++i];
    } else {
      positional.push(rest[i]);
    }
  }
  return { subcommand, out, positional };
}

function readLocalIfFile(source) {
  if (existsSync(source)) {
    return readFileSync(source, "utf8");
  }
  return source;
}

async function runPrompt(source) {
  const resolved = await resolve(readLocalIfFile(source));
  resolved.whatRead =
    resolved.kind === "arxiv" && !resolved.html
      ? "arXiv abstract page only (no HTML version)"
      : resolved.kind === "arxiv"
        ? "arXiv HTML full text"
        : "provided HTML";
  const prompt = buildMasterPrompt({
    paperText: resolved.html ? extractTextFromHtml(resolved.html) : "",
    figures: resolved.figures || [],
    baseUrl: resolved.baseUrl || "",
    whatRead: resolved.whatRead,
  });
  return { prompt, source: resolved };
}

async function runDigest(source, { outDir, cfg }) {
  const resolved = await resolve(readLocalIfFile(source));
  if (resolved.kind === "pdf") {
    throw new Error("PDF text extraction is not implemented; supply HTML or a URL.");
  }
  const paperText = resolved.html ? extractTextFromHtml(resolved.html) : "";
  resolved.whatRead =
    resolved.kind === "arxiv" && !resolved.html
      ? "arXiv abstract page only (no HTML version)"
      : resolved.kind === "arxiv"
        ? "arXiv HTML full text"
        : "provided HTML";

  const llm = createClient(cfg);
  const digest = await digestSource(resolved, { client: llm });

  // Persist intermediate digest JSON next to the output.
  await mkdir(outDir, { recursive: true });
  const baseName = outputFilenameBase(digest, resolved);
  const jsonPath = join(outDir, baseName + ".json");
  await writeFile(jsonPath, JSON.stringify(digest, null, 2), "utf8");

  const html = await renderString(digest, resolved);
  const htmlPath = join(outDir, baseName + ".html");
  await writeFile(htmlPath, html, "utf8");

  return { digest, jsonPath, htmlPath, source: resolved };
}

async function runTemplate(jsonPath, { outDir }) {
  const text = await readFile(jsonPath, "utf8");
  const { _salvaged, ...digest } = extractJson(text);
  if (_salvaged) {
    console.warn(`[paper-digest] salvaged malformed JSON from ${jsonPath}`);
  }
  // Reconstruct a minimal source descriptor from whatever metadata the JSON carries.
  const source = {
    figures: digest.figures || [],
    baseUrl: digest.baseUrl || "",
    value: jsonPath,
  };
  const outPath = await renderFile(digest, source, outDir);
  return { outPath, digest };
}

function extractTextFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function run(argv) {
  const { subcommand, out, positional } = parseArgs(argv);

  if (subcommand === "prompt") {
    if (positional.length === 0) {
      console.error("Usage: paper-digest prompt <source> [--out <file>]");
      process.exit(1);
    }
    const { prompt, source } = await runPrompt(positional[0]);
    if (out !== DEFAULT_OUT) {
      await writeFile(out, prompt, "utf8");
      console.log(`Wrote prompt to ${out}`);
    } else {
      process.stdout.write(prompt);
    }
    return;
  }

  if (subcommand === "digest") {
    if (positional.length === 0) {
      console.error("Usage: paper-digest digest <source> [--out <dir>]");
      process.exit(1);
    }
    const cfg = loadConfig();
    const result = await runDigest(positional[0], { outDir: out, cfg });
    console.log(`Wrote ${result.htmlPath}`);
    console.log(`Digest JSON: ${result.jsonPath}`);
    console.log(`Verdict: ${result.digest.verdict}`);
    return;
  }

  if (subcommand === "template") {
    if (positional.length === 0) {
      console.error("Usage: paper-digest template <digest.json> [--out <dir>]");
      process.exit(1);
    }
    const { outPath } = await runTemplate(positional[0], { outDir: out });
    console.log(`Wrote ${outPath}`);
    return;
  }

  console.error(
    "Usage: paper-digest <prompt|digest|template> <source|digest.json> [--out <dir|file>]"
  );
  process.exit(1);
}

const mainFile = process.argv[1] || "";
if (mainFile && (mainFile.endsWith("src/cli.js") || mainFile.endsWith("src\\cli.js"))) {
  run(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

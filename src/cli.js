#!/usr/bin/env node
/**
 * paper-digest CLI.
 *
 * Subcommands:
 *
 *   paper-digest prompt <source> [--out <file>]
 *       Fetch the source and print the master prompt (Markdown-output instructions).
 *       Use this to hand the prompt to a chat AI, which returns the digest Markdown.
 *
 *   paper-digest digest <source> [--out <dir>]
 *       Full pipeline: fetch -> OpenRouter agent (Markdown) -> template -> HTML.
 *
 *   paper-digest template <digest.md> [--out <dir>] [--stdout]
 *       Take an already-written digest Markdown (with YAML frontmatter) and render
 *       it into the HTML template. Reads Markdown from a file argument, from `-`,
 *       or from stdin (piped). With --stdout the rendered HTML is written to stdout
 *       instead of a file.
 *
 * source: an arXiv id/link, a URL, raw HTML text, or a local PDF path.
 */

import { resolve } from "./fetch.js";
import { buildMasterPrompt, extractFinal, extractDraft } from "./prompt.js";
import { digestSource, loadConfig, createClient } from "./digest.js";
import { renderString, renderFile, outputFilenameBase, sanitize, shortenedTitle, extractYear, venueAbbv } from "./template.js";
import { extractMarkdown } from "./llm.js";
import { readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { parseHTML, Node } from "linkedom";

const DEFAULT_OUT = "outputs";

function parseArgs(argv) {
  const args = argv.slice(2);
  const subcommand = args[0];
  const rest = args.slice(1);
  let out = DEFAULT_OUT;
  let stdout = false;
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out" || rest[i] === "-o") {
      out = rest[++i];
    } else if (rest[i] === "--stdout" || rest[i] === "-s") {
      stdout = true;
    } else {
      positional.push(rest[i]);
    }
  }
  return { subcommand, out, stdout, positional };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
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

export async function runDigest(source, { outDir, cfg, client } = {}) {
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

  const llm = client || createClient(cfg);
  const md = await digestSource(resolved, { client: llm });

  // md.raw is the full raw agent response (all blocks); unwrap the clean
  // document (<final> else <draft>) to persist as the digest Markdown.
  let mdText = extractFinal(md.raw) ?? extractDraft(md.raw) ?? md.raw;

  // Inject figures and baseUrl into frontmatter so standalone template
  // rendering can resolve image URLs (figures are parsed at fetch time).
  const fmEnd = mdText.indexOf("\n---\n", 4);
  if (fmEnd !== -1) {
    const injection = `figures: ${JSON.stringify(md.figures || [])}\nbaseUrl: ${JSON.stringify(md.baseUrl || "")}\n`;
    mdText = mdText.slice(0, fmEnd + 1) + injection + mdText.slice(fmEnd + 1);
  }

  // Persist intermediate digest Markdown next to the output.
  await mkdir(outDir, { recursive: true });
  const baseName = outputFilenameBase(md, resolved);
  const mdPath = join(outDir, baseName + ".md");
  await writeFile(mdPath, mdText, "utf8");

  // Persist the full raw agent response (all blocks) beside the digest so
  // failures can be diagnosed without re-running the model.
  await writeFile(join(outDir, baseName + ".response.txt"), md.raw, "utf8");

  const html = await renderString(md, resolved);
  const htmlPath = join(outDir, baseName + ".html");
  await writeFile(htmlPath, html, "utf8");

  return { digest: md, mdPath, htmlPath, source: resolved };
}

async function runTemplate(mdPath, { outDir, stdout }) {
  let text;
  let sourceLabel;
  if (mdPath === undefined || mdPath === "-" || mdPath === "") {
    text = await readStdin();
    sourceLabel = "<stdin>";
  } else {
    text = await readFile(mdPath, "utf8");
    sourceLabel = mdPath;
  }
  // Unwrap an agent three-block response (<draft><check><final>) so the
  // Markdown document inside <final> is what gets templated. Takes the last
  // <final> match (like extractFinal in prompt.js), falls back to <draft>,
  // and falls back to the raw text if neither wrapper is present.
  let unwrapped = text;
  const finalMatches = [...String(text).matchAll(/<final>([\s\S]*?)<\/final>/g)];
  if (finalMatches.length > 0) {
    unwrapped = finalMatches[finalMatches.length - 1][1].trim();
  } else {
    const draftMatches = [...String(text).matchAll(/<draft>([\s\S]*?)<\/draft>/g)];
    if (draftMatches.length > 0) {
      unwrapped = draftMatches[draftMatches.length - 1][1].trim();
    }
  }
  const salvagedByUnwrap = unwrapped !== text;
  const { metadata, body, _salvaged, raw } = extractMarkdown(unwrapped);
  if (_salvaged || salvagedByUnwrap) {
    console.warn(`[paper-digest] salvaged malformed Markdown from ${sourceLabel}`);
  }
  // Reconstruct a minimal source descriptor from whatever metadata the markdown carries.
  const source = {
    figures: metadata.figures || [],
    baseUrl: metadata.baseUrl || "",
    value: sourceLabel,
  };
  const digest = {
    ...metadata,
    sections: [], 
    body,
    raw,
  };
  // We need to parse sections from body. 
  const { splitSections, parseIcymi, parseJudge } = await import("./digest.js");
  const sections = splitSections(body);
  for (const s of sections) {
    if (s.id === "icymi") s.entries = parseIcymi(s.content);
    if (s.id === "judge") s.rows = parseJudge(s.content);
  }
  digest.sections = sections;
  const html = await renderString(digest, source);
  let outPath = null;
  if (!stdout) {
    outPath = await renderFile(digest, source, outDir);
  }
  return { html, digest, outPath };
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Extract the paper's body text from HTML for the agent's source text.
 *
 * Chrome is dropped by scoping to the article body (LaTeXML:
 * article.ltx_document or .ltx_page_content; anything else falls back to
 * <body>), not by blacklisting strings. Each <math> contributes its
 * alttext once as inline math; headings get a markdown heading marker;
 * tables are serialised as caption plus pipe-separated rows. Figures are
 * not extracted here — they are carried through the figure list.
 */
// Block-level elements: their children are separated by blank lines.
// Inline elements: their children are joined with spaces.
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "body",
  "html",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "table",
  "caption",
  "tr",
  "td",
  "th",
  "li",
  "dd",
  "dt",
  "figcaption",
]);

// Elements that carry no extractable text for the source dump.
const DROP_TAGS = new Set(["figure", "script", "style", "img", "object", "svg"]);

export function extractTextFromHtml(html) {
  const { document } = parseHTML(html);

  const textOf = (el) => {
    let t = "";
    const collect = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        t += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName.toLowerCase() === "math") {
          const alt = node.getAttribute("alttext");
          if (alt) t += alt;
          return;
        }
        for (const c of node.childNodes) collect(c);
      }
    };
    collect(el);
    return t.replace(/\s+/g, " ").trim();
  };

  const walk = (node) => {
    switch (node.nodeType) {
      case Node.TEXT_NODE:
        return node.textContent.replace(/\s+/g, " ").trim();
      case Node.DOCUMENT_NODE:
      case Node.DOCUMENT_FRAGMENT_NODE:
        return [...node.childNodes]
          .map(walk)
          .filter(Boolean)
          .join("\n\n");
      case Node.ELEMENT_NODE: {
        const tag = node.tagName.toLowerCase();

        // Math: emit the alttext once as inline math; drop the rendered form.
        if (tag === "math") {
          const alt = node.getAttribute("alttext");
          return alt ? `\\(${alt}\\)` : "";
        }
        // Figures are carried through the figure list, not the source text.
        if (DROP_TAGS.has(tag)) return "";

        if (HEADING_TAGS.has(tag)) {
          return (
            "#".repeat(Math.min(Number(tag[1]) || 1, 2)) + " " + textOf(node)
          );
        }

        if (tag === "table") {
          const parts = [];
          const caption = node.querySelector("caption");
          if (caption) {
            const cap = textOf(caption);
            if (cap) parts.push(cap);
          }
          for (const tr of node.querySelectorAll("tr")) {
            const cells = [...tr.querySelectorAll("th, td")].map(textOf);
            if (cells.length) parts.push("| " + cells.join(" | ") + " |");
          }
          return parts.join("\n");
        }

        const kids = [...node.childNodes]
          .map((c) => [c, walk(c)])
          .filter(([, t]) => t);
        const parts = [];
        let pending = null;
        const flush = () => {
          if (pending) {
            parts.push(pending);
            pending = null;
          }
        };
        for (const [c, t] of kids) {
          const isBlock = c.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(c.tagName.toLowerCase());
          if (isBlock) {
            flush();
            parts.push(t);
          } else {
            pending = pending ? pending + " " + t : t;
          }
        }
        flush();
        return BLOCK_TAGS.has(tag) ? parts.join("\n\n") : parts.join(" ");
      }
      default:
        return "";
    }
  };

  // Scope to the paper body (LaTeXML: article.ltx_document or
  // .ltx_page_content); fall back to <body>, then the document element.
  // Pick the first candidate that yields actual text so fragment inputs
  // (e.g. a bare <p>) still produce output.
  const candidates = [
    document.querySelector("article.ltx_document, .ltx_page_content"),
    document.body,
    document.documentElement,
    document,
  ];
  let result = "";
  for (const c of candidates) {
    if (!c) continue;
    result = walk(c).trim();
    if (result) break;
  }
  return result;
}

export async function run(argv) {
  const { subcommand, out, stdout, positional } = parseArgs(argv);

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
    console.log(`Digest Markdown: ${result.mdPath}`);
    console.log(`Verdict: ${result.digest.verdict}`);
    return;
  }

  if (subcommand === "template") {
    if (positional.length > 1) {
      console.error("Usage: paper-digest template [digest.md|-] [--out <dir>] [--stdout]");
      process.exit(1);
    }
    if (positional.length === 0 && process.stdin.isTTY) {
      console.error("Usage: paper-digest template [digest.md|-] [--out <dir>] [--stdout]");
      process.exit(1);
    }
    const { html, digest, outPath } = await runTemplate(positional[0], { outDir: out, stdout });
    if (stdout) {
      process.stdout.write(html);
      return;
    }
    console.log(`${outPath}`); // pipable
    return;
  }

  console.error(
    "Usage: paper-digest <prompt|digest|template> <source|digest.md> [--out <dir|file>] [--stdout]"
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

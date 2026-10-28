/**
 * Baseline test fixtures for paper-digest render output comparison.
 * These digests cover all section types and variations.
 */

export const fixtures = [
  {
    name: "minimal",
    digest: {
      meta: {
        title: "Minimal Paper",
        authors: ["Jane Doe"],
        venue: "arXiv:2610.17099",
        id: "2610.17099",
        whatRead: "arXiv HTML",
        verdict: "A fine paper.",
        overallConfidence: 80,
      },
      sections: [
        { id: "mot", title: "Motivation", confidence: 80, content: "This is the motivation section." },
        { id: "diff", title: "Differentiation", confidence: 85, content: "How this differs from prior work." },
        { id: "core", title: "Core Idea", confidence: 90, content: "The core idea explained." },
        { id: "bg", title: "Background", confidence: 75, content: "Background information." },
        { id: "src", title: "Source", confidence: 80, content: "Source material discussion." },
        { id: "eval", title: "Evaluation", confidence: 85, content: "Evaluation paragraph one.\n\nEvaluation paragraph two." },
        { id: "icymi", title: "ICYMI", confidence: 80, entries: [
          { tag: "pos", text: "Positive finding." },
          { tag: "neg", text: "Negative finding." },
          { tag: "neu", text: "Neutral finding." },
        ]},
        { id: "judge", title: "Judgement", confidence: 80, rows: [
          { question: "Is it novel?", answer: "Yes, very.", conf: 90 },
          { question: "Is it correct?", answer: "Appears so.", conf: 85 },
        ]},
      ],
    },
    ctx: {
      figures: [
        { n: "1", dataA: "S2.F1", caption: "Fig. 1: diagram", url: "https://arxiv.org/html/fig1.png", svg: "" },
        { n: "2", dataA: "S3.F2", caption: "Fig. 2: hardware", url: "", svg: '<svg><text x="10" y="10">cost $& and $$ here</text></svg>' },
      ],
      baseUrl: "https://arxiv.org/html/2610.17099",
    },
  },
  {
    name: "with-figures",
    digest: {
      meta: {
        title: "Paper with Figures",
        authors: ["John Smith"],
        venue: "Nature",
        id: "nature-123",
        whatRead: "Nature HTML",
        verdict: "Excellent contribution.",
        overallConfidence: 95,
      },
      sections: [
        { id: "mot", title: "Motivation", confidence: 90, content: "Motivation with **bold** and *italic*." },
        { id: "core", title: "Core Idea", confidence: 95, content: "Core with math: $$E=mc^2$$ and \\(inline\\)." },
        { id: "eval", title: "Evaluation", confidence: 90, content: "Eval para 1.\n\nEval para 2.\n\nEval para 3." },
        { id: "icymi", title: "ICYMI", confidence: 85, entries: [
          { tag: "accent", text: "Special highlight." },
        ]},
      ],
    },
    ctx: {
      figures: [
        { n: "1", dataA: "F1", caption: "Figure 1", url: "https://nature.com/fig1.png", svg: "" },
        { n: "2", dataA: "F2", caption: "Figure 2", url: "", svg: '<svg width="100" height="50"><rect width="100" height="50" fill="blue"/></svg>' },
      ],
      baseUrl: "https://nature.com/articles/nature-123",
    },
  },
  {
    name: "edge-cases",
    digest: {
      meta: {
        title: "Edge Cases & Special Chars",
        authors: ["A. Uthor", "B. Writer"],
        venue: "IEEE",
        id: "ieee-456",
        whatRead: "IEEE HTML",
        verdict: "Good but has issues.",
        overallConfidence: 70,
      },
      sections: [
        { id: "mot", title: "Motivation", confidence: 60, content: "Text with $100 price and $200 cost. Also \\(x < y\\) math." },
        { id: "diff", title: "Differentiation", confidence: 65, content: "Diff section." },
        { id: "core", title: "Core Idea", confidence: 70, content: "Core with $$sum_{i=1}^n x_i$$ display math." },
        { id: "bg", title: "Background", confidence: 55, content: "Background." },
        { id: "eval", title: "Evaluation", confidence: 70, content: "Single eval paragraph." },
        { id: "icymi", title: "ICYMI", confidence: 75, entries: [] },
        { id: "judge", title: "Judgement", confidence: 80, rows: [] },
        { id: "src", title: "Source", confidence: 70, content: "Source section with <script>alert('xss')</script> HTML." },
      ],
    },
    ctx: {
      figures: [],
      baseUrl: null,
    },
  },
  {
    name: "empty-sections",
    digest: {
      meta: {
        title: "Mostly Empty",
        authors: ["Empty Author"],
        venue: "arXiv",
        id: "empty-001",
        whatRead: "arXiv HTML",
        verdict: "Nothing much.",
        overallConfidence: 10,
      },
      sections: [
        { id: "mot", title: "Motivation", confidence: 10, content: "" },
        { id: "eval", title: "Evaluation", confidence: 10, content: "" },
      ],
    },
    ctx: {
      figures: [],
      baseUrl: "https://arxiv.org/html/empty-001",
    },
  },
];
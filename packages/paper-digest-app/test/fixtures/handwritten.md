---
title: A Sample Paper for Digest Rendering Tests
authors: Jane Doe, John Smith
venue: arXiv:2601.00001v1 [cs.AR]
id: 2601.00001
whatRead: Full text via arXiv HTML (main body and references; no code, no supplementary material)
verdict: This paper proposes a new approach, and the results are promising under the stated assumptions; however, the evaluation is limited to a single dataset, so the generalizability claim is not fully supported.
overallConfidence: 80
---

## Specific background (Confidence: 90%)

Local learning means per-layer objectives with no cross-layer error propagation; the paper defines this in its introduction. Self-supervised learning means training without large labeled datasets, illustrated by the seed-set approach. Both concepts are needed to follow the Core idea section.

## Motivation (Confidence: 85%)

Existing methods require large labeled datasets, which are expensive to collect. This motivates a self-supervised approach that needs only a small seed set.

My read: the motivation is convincing for the narrow setting, but the leap to real-world deployment is not yet demonstrated.

## Core idea (Confidence: 80%)

The method builds a feature map $F$ from the input $X$, then applies a local classifier to each region. With regional features $F$, pre-update weights $V_\mathrm{pre}$, and errors $E$, the classifier update is:

$$Z = F V_\mathrm{pre}^{T},\qquad G_V = E^{T}F,\qquad E_F = E V_\mathrm{pre}$$

The inline form \(E_F = E V_\mathrm{pre}\) shows the error propagation in one line. A multi-line display equation keeps its breaks:

$$
\begin{aligned}
h_t &= e_{\mathrm{raw},t} + \min\{s \ge 0 : U_t \le 127 \cdot 2^{s}\},\\
e_{\mathrm{target},t} &= \max_{i=1,\dots,4} h_{t-i}.
\end{aligned}
$$

A paragraph with a single newline
continues on the next line but should be joined into one paragraph.

<figure data-n="1" data-a="S2.F1"><figcaption>Fig. 1: The proposed architecture. The shared engine runs both convolutions and classifier updates.</figcaption></figure>

## Distinguishing factor (Confidence: 70%)

Against prior work, this method adds regional error expansion and tile folding, which prior GPU methods do not have.

vs. their earlier version: the paper does not describe an earlier version.

## Evaluation and conclusions (Confidence: 78%)

**Accuracy.** The method reaches 76.57% on CIFAR-10 and 91.85% on SVHN. My read: these are the headline numbers and they are reproducible within the paper.

**Throughput.** Effective throughput is 31.22 GMAC/s, about 30% of peak. My read: low utilization is honest, but the stall attribution is a hypothesis.

**Robustness.** Integer local beats Local FP32 but trails FP32 backprop. My read: the gap mostly reflects differing training recipes.

**Conclusion.** The paper concludes that integer local training works with shared arithmetic; the evidence supports feasibility but not mechanism attribution.

## In case you missed it (Confidence: 75%)

- [pos] The loss rewrite uses lookup tables and a shared reciprocal.
- [neu] Weights are updated in the code domain without aligning exponents.
- [neg] The 64 MiB DDR buffer stays reserved after warmup.

## Cautious judgement (Confidence: 65%)

| Question | Answer | Confidence |
| --- | --- | --- |
| Fair comparison to external baselines? | Partly; power boundaries differ. | 70% |
| Invents its own FoM? | No. | 80% |
| Rewrite of an existing idea? | Largely a hardware mapping of existing ideas. | 70% |
| Reliable enough to reuse? | As a reference design, plausibly. | 60% |

## Sources and limits (Confidence: 85%)

I read the full arXiv HTML text including tables and references. I did not read the appendix, supplementary material, or released code, and none of the cited papers were opened. I did not check derivations or arithmetic.

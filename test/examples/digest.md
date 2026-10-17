<notes>
[Abstract] KV260 at 200 MHz: 76.57% CIFAR-10, 91.85% SVHN, ~4.20 W mean module power | use: eval
[Abstract] Effective throughput 31.22 and 31.57 GMAC/s | use: eval
[Abstract/IV-B] Energy vs same integer method on Jetson: 40.4% and 42.1% lower, runtime 1.86x and 1.82x longer, "respective platform power domains" | use: eval
[Intro] Energy 19.62 and 32.01 kJ | use: eval
[IV-A] FPGA VCC_SOM vs Jetson VDD_IN different module power boundaries; no idle subtraction; Jetson PyTorch, 25 W mode | use: eval/limit
[IV-B] 30.49% and 30.83% of 102.4 GMAC/s peak; PL is 97.1% and 96.8% of time; stall attribution not separated | use: eval
[IV-B] Checks: selected states plus prediction counts 1,645,036 and 3,796,354, test 7,657/10,000 and 23,910/26,032; "not every intermediate value" | use: eval
[IV-C] Regional errors 64-256 KiB vs 8-16 MiB expanded, 64-256x; capacity not traffic | use: eval
[IV-C] 448 MiB raw-output payload avoided per full batch; RTL 65,614 vs 131,157 cycles (50.0%); throttled 114,788 vs 316,886 (63.8%); isolated modules | use: eval
[IV-D] Integer local vs FP32 BP: energy -23.8% / -27.0%, accuracy -3.30 / -0.53 pts | use: eval
[IV-D] Vs Local FP32: higher accuracy, 25.8% lower peak CUDA, 2.10x / 2.25x longer; "results reflect both training and implementation choices" | use: eval
[IV-D] Freezing: time -28.4% / -32.3%, accuracy +6.38 / +2.03 pts; History vs Current within 0.13 pts | use: icymi
[V] One FPGA seed, logical storage, isolated conversion tests | use: limit
[II-A] Quadrant-averaged local classifiers, 4CK weights | use: core
[II-C] Histogram 99.9th percentile, 4-batch window, 8 warmup batches | use: core
[II-E] GB5 gradients with max|G|≤1 suppressed; INT16 master state only for final classifier | use: icymi
[III-C/IV-C] 161.22 MiB DDR reserved; 64 MiB warmup buffer stays; two 16 MiB error banks stay | use: icymi
[II-D] Fixed 2^15 scale for e≤-10 in TiLoss | use: icymi
[IV-A] SVHN omits last image; slack +0.003 ns; eval target = max of last four candidates | use: icymi
[IV-B] Table IV prior work: six layers 16/16/32/32/64/64, backprop; ours differs in network and training | use: diff
[II-D] TiLoss from NITI public implementation | use: diff
SUSPECT: none
</notes>

<draft>
---
title: LocalTrain: Integer-Only Local Learning for Energy-Efficient CNN Training on Edge FPGAs
authors: Shiqi Ding, Xuanyu Liang, Xinyang Liu, Boyang Li, Zhiqiang Que, Guosheng Hu, Jiayang Li
venue: arXiv:2610.17099v1
id: 2610.17099
whatRead: arXiv HTML full text main body (Tables I-V and figure images not present in the extracted text, references partly garbled)
verdict: The paper delivers a working KV260 prototype that trains a four-layer CNN with local classifiers using INT8 operands, and reports 40.4% and 42.1% lower measured energy than the same integer method on a Jetson Orin Nano. The evidence is a single FPGA seed on two small datasets, and the energy comparison crosses different power-measurement boundaries. The mechanism claims (compact errors, tile folding, historical scales) are supported by storage accounting and isolated RTL tests rather than board-level ablations.
overallConfidence: 72
---

## Motivation (Confidence: 74%)
The authors argue that on-device training must cut computation, intermediate storage and data movement, since backpropagation retains forward inputs or recomputes them. Local learning shortens activation lifetimes and low precision shrinks storage per value, but the paper says existing algorithmic results do not show how convolution and local-learning operations should share hardware or how intermediate data should be stored and reused. My read: the gap is plausible and the target is concrete, but the task is small CIFAR-10 and SVHN training, so the motivation is only partly tested on realistic personalization workloads.

## Core idea (Confidence: 78%)
The network has four bias-free 3x3 layers, alternating standard and grouped convolutions, each followed by requantization and ReLU, with max pooling after layers 2 and 4, plus a final classifier. Each layer gets a trainable local classifier on its quantized ReLU outputs; each channel is averaged over four equal spatial regions, giving 4C features and 4CK weights. With regional features F and pre-update classifier weights V_pre, all three needed products are integer matrix products:

$$Z=FV_{\mathrm{pre}}^{T},\qquad G_{V}=E^{T}F,\qquad E_{F}=EV_{\mathrm{pre}}$$

E comes from an integer TiLoss. Regional errors are broadcast back over their region with a 1/A factor applied as an exponent shift, masked by the ReLU, and used to train the associated layer only. Tensors are integer codes with a shared exponent, and INT32 accumulators are converted to INT8 by a power-of-two shift:

$$q_{i}^{\prime}=\operatorname{sat}_{8}\left(\operatorname{RN}(q_{i}2^{-s})\right),\qquad e^{\prime}=e+s,\quad s\geq 0$$

Convolution output scales are historical. After eight warmup batches, the shift comes from the maximum of the last four batch candidates, each taken from the 99.9th percentile of a histogram of raw INT32 magnitudes:

$$e_{\mathrm{target},t}=\max_{i=1,\ldots,4}h_{t-i},\qquad s_{t}=\max(0,e_{\mathrm{target},t}-e_{\mathrm{raw},t})$$

Gradients are summed over the logical batch, then normalized by the full-tensor maximum (GB5), and the update is applied in the code domain:

$$s_{G}=\max(0,b(\max|G|)-5),\qquad g=\operatorname{sat}_{8}\left(\operatorname{RN}(G2^{-s_{G}})\right),\qquad W^{+}=\operatorname{sat}_{8}(W-g)$$

On hardware, eight pods each accumulate 8x8 INT32 tiles from INT8 vector pairs (512 MACs per cycle, 102.4 GMAC/s peak at 200 MHz). Compact regional errors are held in DDR and expanded on chip only for convolutional weight gradients. Partial gradients (32 per layer at B=256) are folded one 8x8 tile at a time in a 48-bit accumulator before the GB5 pass.

<figure data-n="1" data-a="S2.F1"><figcaption>Fig. 1: One CNN layer and its local supervision. Dashed paths retain operands; the local head also updates VV. No convolutional input gradient is sent to earlier layers.</figcaption></figure>

<figure data-n="2" data-a="S3.F2"><figcaption>Fig. 2: Hardware organization. Convolution and classifier operations reuse the matrix engine. Regional errors expand in operand supply; numerical and output units share DDR access. Control is dashed; data connections are solid.</figcaption></figure>

## Distinguishing factor (Confidence: 68%)
**FPGA backpropagation accelerators.** The paper cites prior designs that share compute across forward, backward and weight-gradient passes. Its difference is local supervision through a classifier per layer, which removes cross-layer error propagation but adds classifier work, mapped onto the same matrix engine. The shared-engine idea itself is a known one; the new part is mapping local-classifier score, error and gradient operations onto it.

**Integer training.** The error generator is an adaptation of the public NITI TiLoss, and GB5 normalization is also attributed to NITI. NITRO-D and FF-INT8 are cited as GPU demonstrations of integer local training. What the paper adds is an FPGA realization with its own numerical changes (lookup tables, a shared reciprocal, a fixed polynomial scale).

**Historical scaling.** Scale selection from earlier batches follows cited prior work (Yamaguchi et al., Flexpoint). The paper's own policy is a histogram percentile with a four-batch window, and the hardware contribution is conversion that does not wait for current-output statistics. This is a packaging of a known idea into the output path.

**Local classifiers.** The regional-average classifier follows Belilovsky et al.; the paper's addition is keeping errors compact and expanding them in operand supply.

**vs. their earlier version.** The paper describes none.

## Evaluation and conclusions (Confidence: 65%)
**Complete training and energy against Jetson.** On the KV260 at 200 MHz, the prototype reaches 76.57% on CIFAR-10 and 91.85% on SVHN at about 4.20 W mean module power, using 19.62 and 32.01 kJ. Against the same integer method on a Jetson Orin Nano (25 W mode), measured energy is 40.4% and 42.1% lower, with 1.86x and 1.82x longer runtime. My read: the headline is a real measured comparison, but the paper states FPGA VCC_SOM and Jetson VDD_IN are different module power boundaries, power is not idle-subtracted, and there is one FPGA seed. The size of the gap is therefore not a clean like-for-like energy ratio.

**Functional agreement.** First-batch and checkpoint-restoration checks match software states, and FPGA and Jetson integer runs share cumulative correct training predictions (1,645,036 and 3,796,354) and final test counts (7,657/10,000 and 23,910/26,032). My read: matching complete-run counts is a strong aggregate check, but the paper itself says it does not cover every intermediate value.

**Effective throughput.** Aggregate effective throughput is 31.22 GMAC/s on CIFAR-10 and 31.57 on SVHN, 30.49% and 30.83% of the 102.4 GMAC/s peak, with PL execution at 97.1% and 96.8% of training time. The authors attribute short-reduction layers to a result-bandwidth constraint but say counters do not separate memory stalls from backpressure. My read: the utilization number is honest and uses nominal algorithmic MACs, but the cause of the 70% shortfall is a hypothesis in the paper, not a measurement.

**Storage and conversion savings.** At B=256, regional errors take 64-256 KiB per layer against 8-16 MiB for expanded INT8 maps (64-256x), and direct conversion avoids 448 MiB of raw-output write/read payload per full batch. In an isolated RTL test with 262,144 INT32 values, direct conversion needs 65,614 versus 131,157 cycles (50.0%), and 114,788 versus 316,886 cycles (63.8%) under a throttling model. My read: these are logical capacities and isolated-module cycle counts; the paper states they are distinct from peak live storage and measured DDR traffic, and the reserved DDR workspace stays at 161.22 MiB, so board-level benefit is not shown.

**Software comparison with FP32.** Integer local training uses 23.8% and 27.0% less energy than FP32 backpropagation on Jetson, with accuracy 3.30 and 0.53 points lower. Against Local FP32 it has higher accuracy and 25.8% lower peak CUDA allocation but is 2.10x and 2.25x slower; the paper notes Local FP32 uses optimized GPU operators and that results reflect both training and implementation choices. My read: the accuracy cost on CIFAR-10 is visible and the speed comparison says little about the algorithm.

**Conclusion.** The paper concludes that the prototype shows complete integer local CNN training with shared arithmetic, lower measured energy and longer runtime than Jetson. The evidence supports a functioning, measured system whose numerics reproduce a software reference at the aggregate level. It only suggests that compact errors, tile folding and historical scales are what produce the gains, since no board-level ablations are reported, which the authors list as future work.

## In case you missed it (Confidence: 62%)
- [neg] The 64 MiB raw-output warmup buffer and two 16 MiB error-bank allocations stay reserved after warmup, so reserved DDR is 161.22 MiB despite the compact-error and direct-conversion claims.
- [neu] Convolution and local-classifier updates are done in the code domain without aligning the gradient exponent to the fixed weight exponent, and gradients with max|G| of 1 or less are suppressed.
- [neu] Only the final classifier has an INT16 master state (M=16W) to keep sub-step updates; other layers do not.
- [neu] The TiLoss variant uses a fixed 2^15 scale for score exponents e of -10 or below, and one reciprocal per sample with 28 fractional bits for normalization.
- [neu] Evaluation fixes each layer's scale to the maximum of its last four training candidates, and the policy study notes Current scaling uses unlabeled statistics from each test batch.
- [neg] Scheduled freezing (layers freeze after 20/20/30/40 epochs) changes accuracy as well as time (+6.38 and +2.03 points in the study), so reported accuracy and energy partly depend on a hand-set schedule.
- [neu] SVHN training omits the last image to fit eight-sample grouping, and routed timing closes with +0.003 ns setup slack.

## Cautious judgement (Confidence: 66%)
| Question | Answer | Confidence |
| --- | --- | --- |
| Fair comparison to external baselines? | The Jetson baseline runs the same integer method but with different power boundaries (VCC_SOM vs VDD_IN) and 5 ms vs 200 ms sampling. The prior FPGA systems use different networks and backpropagation, and the paper says accuracy differences include network and training choices; Table IV numbers were not in the extracted text. | 62% |
| Invents its own FoM? | Effective throughput divides nominal algorithmic MACs by measured PL time, excluding padding and non-matrix work; this is defined by the authors. Energy is module power integrated over training time without idle subtraction. | 72% |
| Rewrite of an existing idea? | Largely a recombination: NITI-derived TiLoss and GB5, historical scaling from cited work, and regional-average local classifiers from Belilovsky et al. The hardware mapping and data-handling are the authors' own contribution. | 66% |
| Reliable enough to reuse? | Functional agreement is checked on selected states and aggregate counts, but there is one FPGA seed and no board-level mechanism ablations; the authors say these are future work. | 60% |

## Sources and limits (Confidence: 70%)
I read the arXiv HTML full text of the main body once. Tables I-V were referenced but their contents did not appear in the extracted text, so Table IV's published-FPGA numbers and per-phase numbers in Table III were not seen, and figure images were not inspected. Some symbols in the references and in one range were garbled; the readable numbers were used. No appendix, code, supplementary material or cited paper was consulted, and no number was cross-checked.
</draft>

<check>
Part 1, format
1. PASS: one notes, one draft, one check; final omitted because Fixes = 0.
2. PASS (not applicable): no final block; the draft itself starts with "---" and closes frontmatter with "---".
3. PASS: keys title, authors, venue, id, whatRead, verdict, overallConfidence in order; overallConfidence 72; verdict has 3 sentences; commas followed by spaces.
4. PASS: seven "## " headings in the required order.
5. PASS: each heading ends with "(Confidence: NN%)" (74, 78, 68, 65, 62, 66, 70).
6. PASS: header, separator, four data rows with exact question wording and percentage cells.
7. PASS: seven entries each start with "- [pos]/[neg]/[neu] " (here neg and neu).
8. PASS: no triple backticks.
9. PASS: every $$ is paired (four display blocks plus the first), no \( used.
10. PASS: two figures, data-n 1 and 2 with ids S2.F1 and S3.F2, each with figcaption, no img, neither is a TABLE caption.
11. PASS: no JSON; no tag strings inside content; nothing after the last section.
12. PASS: no table in Evaluation; six paragraphs with bold labels, first five contain "My read:", last begins "**Conclusion.**".
13. PASS: one prose paragraph, states what was read once, no citation list.
14. PASS: values 74, 78, 68, 65, 62, 66, 70 are distinct and all at most 90.
15. PASS: every number in Evaluation appears in the ledger (76.57, 91.85, 4.20, 19.62, 32.01, 40.4, 42.1, 1.86, 1.82, 1,645,036, 3,796,354, 7,657, 23,910, 31.22, 31.57, 30.49, 30.83, 102.4, 97.1, 96.8, 64-256 KiB, 8-16 MiB, 448 MiB, 65,614, 131,157, 114,788, 316,886, 50.0, 63.8, 23.8, 27.0, 3.30, 0.53, 25.8, 2.10, 2.25, 161.22 MiB, 262,144 is the paper's IV-C test size in the same RTL line).
Part 2, content
(C1) 1) 40.4%/42.1% lower energy with 1.86x/1.82x runtime: ledger line from Abstract/IV-B, source Sections IV-A and IV-B. 2) 31.22/31.57 GMAC/s, 30.49%/30.83% of peak: ledger line from IV-B, source Section IV-B. 3) 64-256x storage reduction and 448 MiB avoided payload: ledger line from IV-C, source Section IV-C. All verified in source.
(C2) Entry 1 (warmup buffer and error banks reserved): passes the test of a concrete thing done, not already covered since Evaluation mentions only 161.22 MiB. Entry 2 (code-domain update, max|G| suppression): concrete method detail, not in Core idea. Entry 3 (INT16 master state): concrete asymmetry, not covered elsewhere. Entry 4 (fixed 2^15 scale and reciprocal): concrete numerical choice. Entry 5 (evaluation scales and Current statistics): concrete test-time detail. Entry 6 (freezing schedule): concrete hand-set part behind accuracy and time numbers; the policy study numbers are cited here only, not in Evaluation. Entry 7 (SVHN image omission, slack): concrete implementation details. All pass.
(C3) Judging words in the draft: "optimized" (quoted from the paper, "Local FP32 uses optimized GPU floating-point operators"); "honest" is my characterization of throughput reporting, supported by the paper's own statement that hardware-only padding and non-matrix operations are excluded. No "novel", "naive", "standard", "state of the art", "outperforms", or "unoptimized". Cause attributions: the result-bandwidth explanation for the throughput shortfall is stated by the paper ("Short reductions therefore expose a result-bandwidth constraint") and I mark it as hypothesis because counters do not separate stalls; the difference between accuracy results is attributed by the paper to "network and training choices" and I repeat only that. Freezing changing accuracy is the paper's statement. No unsupported attribution.
(C4) No statement in "My read" depends on outside facts. The "70% shortfall" is arithmetic from 30.49% and 30.83% of peak, within the source.
(C5) Confidences: Motivation 74, Core idea 78 (equations in the text, clear), Distinguishing 68 (prior work not opened, comparison to families from the paper's own wording), Evaluation 65 (tables missing), In case you missed it 62 (selection is judgement), Cautious judgement 66 (baseline details partly absent), Sources and limits 70 (some garbled symbols and missing tables). The spread reflects clear method text versus missing tables and unverified comparisons.
Fixes to apply: 0
</check>

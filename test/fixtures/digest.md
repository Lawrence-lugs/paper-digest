<draft>
---
title: LocalTrain: Integer-Only Local Learning for Energy-Efficient CNN Training on Edge FPGAs
authors: Shiqi Ding, Xuanyu Liang, Xinyang Liu, Boyang Li, Zhiqiang Que, Guosheng Hu, Jiayang Li
venue: arXiv:2610.17099v1 [cs.AR]
id: 2610.17099
whatRead: Full text via arXiv HTML (main body and references; no code, no supplementary material)
verdict: The paper reports a working KV260 prototype that trains a four-layer CNN and its local classifiers from scratch with integer arithmetic on one shared matrix engine. The energy advantage over an integer-method Jetson run is measured under different power boundaries, and the mechanism claims (compact errors, tile folding, direct conversion) rest on logical-capacity accounting and isolated RTL tests rather than board-level ablations. My read is that it is credible as a feasibility demonstration and weak as attribution of gains to individual mechanisms.
overallConfidence: 76
---

## Motivation (Confidence: 80%)
The paper argues that on-device training is bottlenecked by computation, retained forward activations, and data movement. Local learning (a per-layer objective, no cross-layer error propagation) and integer arithmetic each address part of this, and NITRO-D and FF-INT8 show integer local training works on GPUs. The authors say the open question is hardware: how convolution and local-classifier operations should share resources, and how saved operands, gradients, and quantization scales should be stored and reused. They add that local learning still needs operand retention, gradient accumulation, and scale selection.

My read: the gap is real and specific. Earlier FPGA trainers share engines across forward, backward, and weight-gradient passes, but not across local-classifier work. The motivation is less convincing on the energy side, since the baseline is the authors' own integer implementation on a GPU.

## Core idea (Confidence: 85%)
Each of four convolutional layers (alternating standard and grouped 3×3, bias-free) has a trainable local classifier on its quantized ReLU outputs. Each channel is averaged over four spatial regions, giving \(4C\) features per layer rather than \(HWC\). With regional features \(F\), pre-update classifier weights \(V_{\mathrm{pre}}\), and classifier errors \(E\), all three classifier computations are matrix products that run on the same engine as the convolutions:

$$Z = F V_{\mathrm{pre}}^{T},\qquad G_V = E^{T}F,\qquad E_F = E V_{\mathrm{pre}}$$

Regional errors \(E_F\) stay compact in DDR. They are broadcast over their region on chip only when the convolutional weight gradient needs spatial errors. The \(1/A\) averaging factor is folded into the exponent, and a ReLU mask is applied. Training finishes one layer before the next, so saved inputs can be reused afterward.

Numerics are shared-exponent INT8 with INT32 accumulation. Conversion divides every code in a tensor by one power of two:

$$q_i' = \operatorname{sat}_8\!\big(\operatorname{RN}(q_i 2^{-s})\big),\qquad e' = e + s,\quad s\ge 0$$

Convolutional output scales come from history rather than the current batch. After eight warmup batches, a histogram of raw INT32 magnitudes gives the 99.9th-percentile bin bound \(U_t\), a candidate exponent \(h_t\), and a target that is the maximum over the previous four batches:

$$h_t = e_{\mathrm{raw},t} + \min\{s\ge 0 : U_t \le 127\cdot 2^{s}\},\qquad e_{\mathrm{target},t}=\max_{i=1,\dots,4} h_{t-i}$$

This lets INT32-to-INT8 conversion happen directly as outputs stream out, while the histogram observes the raw codes in parallel.

Weight gradients are normalized per tensor by GB5, which targets a 5-bit magnitude, \(s_G=\max(0,\,b(\max|G|)-5)\). GB5 needs the complete batch gradient range before any update. The hardware therefore folds 32 partial gradient tensors (for \(B=256\), eight-sample groups) one 8×8 tile at a time through a 48-bit accumulator of 384 bytes of logical storage, with two 256-byte prefetch buffers.

The engine has eight pods of 8×8 INT8 outer-product tiles, so 512 MAC/cycle and a 102.4 GMAC/s peak at 200 MHz. The final classifier uses an INT16 master weight state \(M=16W\) so updates smaller than one INT8 step are kept. Classification errors use an FPGA-friendly adaptation of NITI's TiLoss, with lookup tables, one shared 28-fractional-bit reciprocal per sample, and a fixed \(2^{15}\) polynomial scale for small exponents.

<figure data-n="1" data-a="S2.F1"><figcaption>Fig. 1: One CNN layer and its local supervision. Dashed paths retain operands; the local head also updates V. No convolutional input gradient is sent to earlier layers.</figcaption></figure>

<figure data-n="2" data-a="S3.F2"><figcaption>Fig. 2: Hardware organization. Convolution and classifier operations reuse the matrix engine. Regional errors expand in operand supply; numerical and output units share DDR access. Control is dashed; data connections are solid.</figcaption></figure>

## Distinguishing factor (Confidence: 70%)
Against integer training algorithms (NITI, NITRO-D, FF-INT8): these are algorithm-level, mostly GPU results. The paper reuses NITI's TiLoss structure and its code-domain updates, and its new content is the hardware mapping and the FPGA-oriented rewrite of the loss (lookup tables, shared reciprocal, bounded polynomial). The training rules themselves are largely inherited.

Against FPGA backpropagation accelerators (EF-Train, Venkataramanaiah et al., Shao et al.): these share compute across forward, backward, and weight-gradient passes. Here the shared engine also absorbs local-classifier score, feature-error, and classifier-gradient products (Table I), and local supervision removes the cross-layer input-gradient path. The comparison in Table IV mixes six-layer narrow backprop networks with a four-layer wider, partly grouped local-learning network, so accuracy and energy are not like-for-like, and the paper says so.

Against historical-scaling work (Flexpoint, Yamaguchi et al.): the idea of using earlier batches to pick scales is adopted. The paper's specific choices are histogram percentiles, a four-batch window, and an eight-batch warmup, plus the hardware that makes direct conversion possible. Saturation is allowed and no clipping rate is guaranteed.

vs. their earlier version: the paper does not describe an earlier version in the text I read, and none was fetched.

## Evaluation and conclusions (Confidence: 78%)
Complete training on the KV260 at 200 MHz reaches 76.57% on CIFAR-10 (50 epochs) and 91.85% on SVHN (60 epochs), at about 4.20 W mean VCC_SOM power. Against the same integer method on a Jetson Orin Nano (25 W mode), measured energy is 40.4% and 42.1% lower, with 1.86× and 1.82× longer runtime. My read: this is the headline claim, and the boundaries differ. The FPGA measures VCC_SOM and the Jetson measures VDD_IN, with no idle subtraction, and the Jetson integer path is custom numerics in PyTorch, not an optimized kernel. The paper's own Jetson table shows Local FP32 on the Jetson at lower energy than the FPGA's CIFAR-10 figure, again under different boundaries. The FPGA's energy advantage therefore holds against the integer-on-GPU implementation specifically, not against a good GPU local-learning baseline. Functional agreement is supported by matched cumulative training predictions and final test counts between FPGA and Jetson integer runs, plus selected first-batch and checkpoint-restore state checks. The authors correctly say this is not every intermediate value.

Effective throughput is 31.22 and 31.57 GMAC/s, about 30% of the 102.4 peak. It is computed as nominal algorithmic MACs divided by measured PL time, and PL time is about 97% of wall time. The first two convolutions have short reductions (36 and 72 steps) against 128 result transfers for eight tiles, so result bandwidth is flagged as a constraint. My read: the number is honest about low utilization, but the stall attribution is a hypothesis, since the counters do not separate memory stalls from result backpressure.

Storage and conversion results are the mechanism evidence. Compact regional errors take 64 to 256 KiB per layer against 8 to 16 MiB for expanded INT8 spatial errors, and tile folding replaces a 432 KiB resident accumulator (conv 3) with 384 bytes plus 512 bytes of prefetch. Direct conversion avoids 448 MiB of raw-output write/read payload per full batch after warmup. In an isolated RTL test (262,144 INT32 values), direct conversion takes 50.0% fewer cycles with always-ready interfaces and 63.8% fewer under a fixed throttling model. My read: these are logical capacities and payload counts, not measured DDR traffic or peak live storage, and the reserved DDR workspace stays at 161.22 MiB. The module test excludes convolution and external scratch control. These mechanisms are plausible but not demonstrated on the board.

Software accuracy on the Jetson is somewhat surprising. Integer local (76.57% on CIFAR-10) beats Local FP32 (74.43%) but trails FP32 backprop (79.87%). Scheduled freezing cuts training time 28.4% and 32.3% while raising accuracy 6.38 and 2.03 points in a within-study comparison. My read: the integer-over-FP32 result mostly reflects differing training recipes (Adam and cross-entropy versus integer rules and scaling), which the authors partly acknowledge. The freezing gain means the schedule is part of the reported result, not a free speedup.

The paper's conclusion is that complete integer local CNN training works with shared arithmetic, that compact errors, folding, and historical scales reduce buffering, and that energy is lower though runtime is longer. It also states the evidence covers one FPGA seed, logical storage savings, and isolated conversion tests. My read: the evidence supports the feasibility and the energy-versus-Jetson-integer claim under stated caveats, and does not yet support attributing the gains to specific mechanisms.

## In case you missed it (Confidence: 75%)
- [pos] The TiLoss rewrite is concrete: lookup tables for score exponents above -7, one reciprocal with 28 fractional bits shared across all classes per sample, a fixed \(2^{15}\) scale for exponents at or below -10, and stochastic division by 16 to reach INT8 errors.
- [neu] Convolutional and local-classifier weights are updated in the code domain without aligning the gradient exponent to the fixed weight exponent; only the final classifier gets an INT16 master state (\(M=16W\), clipped to ±2032) that preserves sub-step updates.
- [neg] The 64 MiB DDR buffer for raw outputs during warmup stays reserved afterward, so direct conversion removes traffic but not reserved capacity; total reserved DDR workspace stays at 161.22 MiB.
- [neu] The histogram unit is 8 banks of 33 counters of 25 bits in LUTRAM with HLS initiation interval of one; the PS merges bank counts, checks the output count, and keeps the scale history. At evaluation, each layer's target is fixed to the maximum of its last four training candidates.
- [neu] The deployed configuration bakes in layer freezing after 20/20/30/40 epochs, gradients with max magnitude at or below 1 are suppressed, and the final classifier's learning-rate shift changes from 24 to 25 after epoch 40.
- [neg] The PS supplies all random values (dropout, stochastic rounding) through DDR and maintains scale history, so training is not fully self-contained on the PL; the SVHN run also drops one training image to fit eight-sample grouping.

## Cautious judgement (Confidence: 65%)

| Question | Answer | Confidence |
| --- | --- | --- |
| Fair comparison to external baselines? | Partly. The same integer method on Jetson is a controlled comparison, but power boundaries differ (VCC_SOM vs VDD_IN, no idle subtraction) and the Jetson integer path is unoptimized custom code. The FPGA literature table mixes different networks, precisions, and tool-estimated power, and the authors disclaim an energy ranking. | 72% |
| Invents its own FoM? | No new headline metric. Effective GMAC/s is derived from nominal algorithmic MACs over PL time (excluding padding and non-matrix work), and logical storage reductions are capacity counts, not measured traffic. | 78% |
| Rewrite of an existing idea? | Largely a hardware mapping of existing ideas: NITI-style integer training and TiLoss, local classifiers after Belilovsky et al., historical scaling after Flexpoint and Yamaguchi. The novelty is the shared-engine mapping, regional-error expansion, tile folding, and direct conversion. | 68% |
| Reliable enough to reuse? | As a reference design for reimplementation, plausibly, given detailed numerics and state-matching checks. As evidence that each mechanism produces the stated gain, no: single FPGA seed, no board ablations, no stall breakdown, no code read. | 60% |

## Sources and limits (Confidence: 90%)
I read the full arXiv HTML text of v1 (main body, tables, and reference list). The two figures were identified by caption only and I did not view them. I did not read an appendix, supplementary material, or released code, and none of the cited papers were opened. I did not check derivations or arithmetic. I did not verify the isolated RTL results, the Table IV derived energies, or the claimed functional-agreement checks beyond what the paper reports. The extracted text contained some encoding noise in symbols; I relied on the clean LaTeX forms where present.
</draft>
<check>
1. PASS. One draft block, then this check, then one final block, in that order, nothing outside them.
2. PASS. The final block starts with "---" and the frontmatter closes with a second "---" line.
3. PASS. Keys in order: title, authors, venue, id, whatRead, verdict, overallConfidence; overallConfidence is the bare integer 76.
4. PASS. Seven "## " headings found once each, in the required order: Motivation, Core idea, Distinguishing factor, Evaluation and conclusions, In case you missed it, Cautious judgement, Sources and limits.
5. PASS. Every heading ends with " (Confidence: NN%)" with real values 80, 85, 70, 78, 75, 65, 90.
6. PASS. The table has a header row, a separator row, and four data rows with the questions worded exactly as given; the Confidence cells are 72%, 78%, 68%, 60%.
7. PASS. All six entries start with "- [pos] ", "- [neg] ", or "- [neu] " on their own lines.
8. PASS. No triple backticks anywhere.
9. PASS. Each $$ pair is closed (four display blocks) and every \( has a matching \).
10. PASS. Two figures: data-n 1 with data-a S2.F1 and data-n 2 with data-a S3.F2, both from the figure list and both with a figcaption; no img tag.
11. PASS. No JSON, nothing before the frontmatter or after the last section, and none of the three tag strings appear inside block contents.
12. PASS. Evaluation and conclusions is prose with no table.
C1. PASS. Claims trace to the paper's text and tables. Items not checked are marked as such (RTL results, Table IV derived energies, state-match checks, stall attribution as a hypothesis, no earlier version described or fetched).
C2. PASS. Section confidences vary (65 to 90).
Fixes to apply: 0
</check>
<final>
---
title: LocalTrain: Integer-Only Local Learning for Energy-Efficient CNN Training on Edge FPGAs
authors: Shiqi Ding, Xuanyu Liang, Xinyang Liu, Boyang Li, Zhiqiang Que, Guosheng Hu, Jiayang Li
venue: arXiv:2610.17099v1 [cs.AR]
id: 2610.17099
whatRead: Full text via arXiv HTML (main body and references; no code, no supplementary material)
verdict: The paper reports a working KV260 prototype that trains a four-layer CNN and its local classifiers from scratch with integer arithmetic on one shared matrix engine. The energy advantage over an integer-method Jetson run is measured under different power boundaries, and the mechanism claims (compact errors, tile folding, direct conversion) rest on logical-capacity accounting and isolated RTL tests rather than board-level ablations. My read is that it is credible as a feasibility demonstration and weak as attribution of gains to individual mechanisms.
overallConfidence: 76
---

## Motivation (Confidence: 80%)
The paper argues that on-device training is bottlenecked by computation, retained forward activations, and data movement. Local learning (a per-layer objective, no cross-layer error propagation) and integer arithmetic each address part of this, and NITRO-D and FF-INT8 show integer local training works on GPUs. The authors say the open question is hardware: how convolution and local-classifier operations should share resources, and how saved operands, gradients, and quantization scales should be stored and reused. They add that local learning still needs operand retention, gradient accumulation, and scale selection.

My read: the gap is real and specific. Earlier FPGA trainers share engines across forward, backward, and weight-gradient passes, but not across local-classifier work. The motivation is less convincing on the energy side, since the baseline is the authors' own integer implementation on a GPU.

## Core idea (Confidence: 85%)
Each of four convolutional layers (alternating standard and grouped 3×3, bias-free) has a trainable local classifier on its quantized ReLU outputs. Each channel is averaged over four spatial regions, giving \(4C\) features per layer rather than \(HWC\). With regional features \(F\), pre-update classifier weights \(V_{\mathrm{pre}}\), and classifier errors \(E\), all three classifier computations are matrix products that run on the same engine as the convolutions:

$$Z = F V_{\mathrm{pre}}^{T},\qquad G_V = E^{T}F,\qquad E_F = E V_{\mathrm{pre}}$$

Regional errors \(E_F\) stay compact in DDR. They are broadcast over their region on chip only when the convolutional weight gradient needs spatial errors. The \(1/A\) averaging factor is folded into the exponent, and a ReLU mask is applied. Training finishes one layer before the next, so saved inputs can be reused afterward.

Numerics are shared-exponent INT8 with INT32 accumulation. Conversion divides every code in a tensor by one power of two:

$$q_i' = \operatorname{sat}_8\!\big(\operatorname{RN}(q_i 2^{-s})\big),\qquad e' = e + s,\quad s\ge 0$$

Convolutional output scales come from history rather than the current batch. After eight warmup batches, a histogram of raw INT32 magnitudes gives the 99.9th-percentile bin bound \(U_t\), a candidate exponent \(h_t\), and a target that is the maximum over the previous four batches:

$$h_t = e_{\mathrm{raw},t} + \min\{s\ge 0 : U_t \le 127\cdot 2^{s}\},\qquad e_{\mathrm{target},t}=\max_{i=1,\dots,4} h_{t-i}$$

This lets INT32-to-INT8 conversion happen directly as outputs stream out, while the histogram observes the raw codes in parallel.

Weight gradients are normalized per tensor by GB5, which targets a 5-bit magnitude, \(s_G=\max(0,\,b(\max|G|)-5)\). GB5 needs the complete batch gradient range before any update. The hardware therefore folds 32 partial gradient tensors (for \(B=256\), eight-sample groups) one 8×8 tile at a time through a 48-bit accumulator of 384 bytes of logical storage, with two 256-byte prefetch buffers.

The engine has eight pods of 8×8 INT8 outer-product tiles, so 512 MAC/cycle and a 102.4 GMAC/s peak at 200 MHz. The final classifier uses an INT16 master weight state \(M=16W\) so updates smaller than one INT8 step are kept. Classification errors use an FPGA-friendly adaptation of NITI's TiLoss, with lookup tables, one shared 28-fractional-bit reciprocal per sample, and a fixed \(2^{15}\) polynomial scale for small exponents.

<figure data-n="1" data-a="S2.F1"><figcaption>Fig. 1: One CNN layer and its local supervision. Dashed paths retain operands; the local head also updates V. No convolutional input gradient is sent to earlier layers.</figcaption></figure>

<figure data-n="2" data-a="S3.F2"><figcaption>Fig. 2: Hardware organization. Convolution and classifier operations reuse the matrix engine. Regional errors expand in operand supply; numerical and output units share DDR access. Control is dashed; data connections are solid.</figcaption></figure>

## Distinguishing factor (Confidence: 70%)
Against integer training algorithms (NITI, NITRO-D, FF-INT8): these are algorithm-level, mostly GPU results. The paper reuses NITI's TiLoss structure and its code-domain updates, and its new content is the hardware mapping and the FPGA-oriented rewrite of the loss (lookup tables, shared reciprocal, bounded polynomial). The training rules themselves are largely inherited.

Against FPGA backpropagation accelerators (EF-Train, Venkataramanaiah et al., Shao et al.): these share compute across forward, backward, and weight-gradient passes. Here the shared engine also absorbs local-classifier score, feature-error, and classifier-gradient products (Table I), and local supervision removes the cross-layer input-gradient path. The comparison in Table IV mixes six-layer narrow backprop networks with a four-layer wider, partly grouped local-learning network, so accuracy and energy are not like-for-like, and the paper says so.

Against historical-scaling work (Flexpoint, Yamaguchi et al.): the idea of using earlier batches to pick scales is adopted. The paper's specific choices are histogram percentiles, a four-batch window, and an eight-batch warmup, plus the hardware that makes direct conversion possible. Saturation is allowed and no clipping rate is guaranteed.

vs. their earlier version: the paper does not describe an earlier version in the text I read, and none was fetched.

## Evaluation and conclusions (Confidence: 78%)
Complete training on the KV260 at 200 MHz reaches 76.57% on CIFAR-10 (50 epochs) and 91.85% on SVHN (60 epochs), at about 4.20 W mean VCC_SOM power. Against the same integer method on a Jetson Orin Nano (25 W mode), measured energy is 40.4% and 42.1% lower, with 1.86× and 1.82× longer runtime. My read: this is the headline claim, and the boundaries differ. The FPGA measures VCC_SOM and the Jetson measures VDD_IN, with no idle subtraction, and the Jetson integer path is custom numerics in PyTorch, not an optimized kernel. The paper's own Jetson table shows Local FP32 on the Jetson at lower energy than the FPGA's CIFAR-10 figure, again under different boundaries. The FPGA's energy advantage therefore holds against the integer-on-GPU implementation specifically, not against a good GPU local-learning baseline. Functional agreement is supported by matched cumulative training predictions and final test counts between FPGA and Jetson integer runs, plus selected first-batch and checkpoint-restore state checks. The authors correctly say this is not every intermediate value.

Effective throughput is 31.22 and 31.57 GMAC/s, about 30% of the 102.4 peak. It is computed as nominal algorithmic MACs divided by measured PL time, and PL time is about 97% of wall time. The first two convolutions have short reductions (36 and 72 steps) against 128 result transfers for eight tiles, so result bandwidth is flagged as a constraint. My read: the number is honest about low utilization, but the stall attribution is a hypothesis, since the counters do not separate memory stalls from result backpressure.

Storage and conversion results are the mechanism evidence. Compact regional errors take 64 to 256 KiB per layer against 8 to 16 MiB for expanded INT8 spatial errors, and tile folding replaces a 432 KiB resident accumulator (conv 3) with 384 bytes plus 512 bytes of prefetch. Direct conversion avoids 448 MiB of raw-output write/read payload per full batch after warmup. In an isolated RTL test (262,144 INT32 values), direct conversion takes 50.0% fewer cycles with always-ready interfaces and 63.8% fewer under a fixed throttling model. My read: these are logical capacities and payload counts, not measured DDR traffic or peak live storage, and the reserved DDR workspace stays at 161.22 MiB. The module test excludes convolution and external scratch control. These mechanisms are plausible but not demonstrated on the board.

Software accuracy on the Jetson is somewhat surprising. Integer local (76.57% on CIFAR-10) beats Local FP32 (74.43%) but trails FP32 backprop (79.87%). Scheduled freezing cuts training time 28.4% and 32.3% while raising accuracy 6.38 and 2.03 points in a within-study comparison. My read: the integer-over-FP32 result mostly reflects differing training recipes (Adam and cross-entropy versus integer rules and scaling), which the authors partly acknowledge. The freezing gain means the schedule is part of the reported result, not a free speedup.

The paper's conclusion is that complete integer local CNN training works with shared arithmetic, that compact errors, folding, and historical scales reduce buffering, and that energy is lower though runtime is longer. It also states the evidence covers one FPGA seed, logical storage savings, and isolated conversion tests. My read: the evidence supports the feasibility and the energy-versus-Jetson-integer claim under stated caveats, and does not yet support attributing the gains to specific mechanisms.

## In case you missed it (Confidence: 75%)
- [pos] The TiLoss rewrite is concrete: lookup tables for score exponents above -7, one reciprocal with 28 fractional bits shared across all classes per sample, a fixed \(2^{15}\) scale for exponents at or below -10, and stochastic division by 16 to reach INT8 errors.
- [neu] Convolutional and local-classifier weights are updated in the code domain without aligning the gradient exponent to the fixed weight exponent; only the final classifier gets an INT16 master state (\(M=16W\), clipped to ±2032) that preserves sub-step updates.
- [neg] The 64 MiB DDR buffer for raw outputs during warmup stays reserved afterward, so direct conversion removes traffic but not reserved capacity; total reserved DDR workspace stays at 161.22 MiB.
- [neu] The histogram unit is 8 banks of 33 counters of 25 bits in LUTRAM with HLS initiation interval of one; the PS merges bank counts, checks the output count, and keeps the scale history. At evaluation, each layer's target is fixed to the maximum of its last four training candidates.
- [neu] The deployed configuration bakes in layer freezing after 20/20/30/40 epochs, gradients with max magnitude at or below 1 are suppressed, and the final classifier's learning-rate shift changes from 24 to 25 after epoch 40.
- [neg] The PS supplies all random values (dropout, stochastic rounding) through DDR and maintains scale history, so training is not fully self-contained on the PL; the SVHN run also drops one training image to fit eight-sample grouping.

## Cautious judgement (Confidence: 65%)

| Question | Answer | Confidence |
| --- | --- | --- |
| Fair comparison to external baselines? | Partly. The same integer method on Jetson is a controlled comparison, but power boundaries differ (VCC_SOM vs VDD_IN, no idle subtraction) and the Jetson integer path is unoptimized custom code. The FPGA literature table mixes different networks, precisions, and tool-estimated power, and the authors disclaim an energy ranking. | 72% |
| Invents its own FoM? | No new headline metric. Effective GMAC/s is derived from nominal algorithmic MACs over PL time (excluding padding and non-matrix work), and logical storage reductions are capacity counts, not measured traffic. | 78% |
| Rewrite of an existing idea? | Largely a hardware mapping of existing ideas: NITI-style integer training and TiLoss, local classifiers after Belilovsky et al., historical scaling after Flexpoint and Yamaguchi. The novelty is the shared-engine mapping, regional-error expansion, tile folding, and direct conversion. | 68% |
| Reliable enough to reuse? | As a reference design for reimplementation, plausibly, given detailed numerics and state-matching checks. As evidence that each mechanism produces the stated gain, no: single FPGA seed, no board ablations, no stall breakdown, no code read. | 60% |

## Sources and limits (Confidence: 90%)
I read the full arXiv HTML text of v1 (main body, tables, and reference list). The two figures were identified by caption only and I did not view them. I did not read an appendix, supplementary material, or released code, and none of the cited papers were opened. I did not check derivations or arithmetic. I did not verify the isolated RTL results, the Table IV derived energies, or the claimed functional-agreement checks beyond what the paper reports. The extracted text contained some encoding noise in symbols; I relied on the clean LaTeX forms where present.
</final>

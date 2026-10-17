---

## title: Closed-Form Optimal Weight Splitting for Matrix–Vector Multiply on Noisy In-Memory Accelerators
authors: Mehmet Aktukmak, David A. Roberts
venue: arXiv:2610.20359v1 [cs.ET]
id: 2610.20359v1
whatRead: arXiv HTML full text
verdict: The paper fills a critical gap in analog in-memory computing (AIMC) weight-slicing theory by incorporating a finite-grid quantization floor alongside additive output noise, deriving a simple closed-form optimal base $b_{\mathrm{opt}}$. Although the additive noise assumption idealizes complex device non-idealities, the resulting interior optimum ($b_{\mathrm{opt}} \approx 5\text{–}6$) demonstrates robustness across full device-physics crossbar simulations and LLM evaluation benchmarks.
overallConfidence: 90

## Motivation (Confidence: 90%)

In analog in-memory computing (AIMC), matrix–vector multiplication (MVM) is executed directly in crossbar arrays via Kirchhoff's laws. Because physical memory cells (e.g., PCM, RRAM) suffer from low per-cell precision and read noise, a standard mitigation is weight splitting across $n_W$ physical cells using a place-value radix/base $b$. This choice exposes a fundamental tension: a large base provides fine resolution but exponentially amplifies the high-significance cell's noise in the summed bit-line current, whereas a base of one ($b=1$, equal-fill duplication) averages noise out but yields zero additional resolution.

Prior analytical work (e.g., Le Gallo et al.) modeled device noise in isolation, yielding a monotonic error curve that strictly favored $b=1$. Practical implementations were thus forced to rely on empirical sweeps or per-device search heuristics. The authors set out to construct a closed-form model that incorporates both finite-grid quantization and device noise, enabling designers to compute the optimal weight-splitting base directly from a single normalized device-noise measurement $\eta$.

**My read:** The motivation is sound and relevant. As AIMC moves toward edge LLM inference and scientific computing, analytical tools that bypass costly per-device heuristic searches are highly practical.

## Core Idea (Confidence: 92%)

The paper formalizes low-precision AIMC weight representation as a custom fixed-point quantization problem with additive hardware noise. For a cell precision of $q$ signed bits ($\mathrm{bound} = 2^{q-1}-1$), a weight $w$ mapped across $n_W=2$ cells is encoded as:

$$\hat{w} = \mathrm{scale} \cdot (s_L + b \, s_H), \quad s_H, s_L \in [-\mathrm{bound}, \mathrm{bound}]$$

where $\mathrm{scale} = W_{\max} / [\mathrm{bound}(1+b)]$.

Assuming additive per-tile read noise $n_k \sim \mathcal{N}(0, \sigma_{\mathrm{out}}^2)$ and uniform master-grid quantization error $\Delta^2 / 12$, the total relative MVM mean squared error simplifies to:

$$\mathrm{relMSE}(b) = k_{\sigma}^2 \eta^2 \frac{1+b^2}{(1+b)^2} + \frac{k_{\sigma}^2}{12 \, \mathrm{bound}^2 (1+b)^2}$$

where $\eta$ is the per-tile output noise normalized by the signal RMS. Differentiating $\mathrm{relMSE}(b)$ with respect to $b$ yields the interior continuous optimum in closed form:

$$b_{\mathrm{opt}} = 1 + \frac{1}{12 \, \mathrm{bound}^2 \, \eta^2}$$

capped at $2\,\mathrm{bound}+1$.

To ensure gap-free representation without low-digit saturation, the base satisfies $b \le \mathrm{bound} + 1$. Additionally, the authors introduce a fixed random block-diagonal orthogonal rotation applied to the weight matrix $W$ before mapping, which acts as incoherence preconditioning to drive operand distributions toward Gaussian and homogenize per-tile noise profiles.

## Distinguishing Factor (Confidence: 90%)

* **vs. Le Gallo et al. [1]:** Le Gallo et al. focused on state-dependent (multiplicative) PCM noise without unifying the quantization floor into the base optimization objective, which naturally resulted in a monotonic preference for $b=1$. Aktukmak and Roberts show that under additive tile output noise, an interior optimum $b_{\mathrm{opt}} > 1$ emerges. Le Gallo's $b=1$ result is shown to be the noise-dominated limit ($\eta \to \infty$) of the authors' generalized formula.
* **vs. Empirical/Evolutionary Search (Mackin et al. [2], Diware et al. [10, 11]):** Rather than running evolutionary algorithms or per-model grid searches to determine bit-significance factors, this work provides an immediate, zero-overhead closed-form calculation derived from a single physical device calibration parameter.
* **vs. Rotated Non-Uniform Encodings (SpinQuant, QuIP# [16, 17]):** While leveraging orthogonal rotation principles, this work targets the multi-cell significance base for uniform physical cell steps rather than learning non-uniform Lloyd-Max codebooks per tile.

## Evaluation and Conclusions (Confidence: 88%)

The authors evaluate their optimal base prediction across three distinct fidelity tiers:

1. **Analytic Monte Carlo (Fig. 2):** Evaluated across noise levels $\eta \in \{0.02, 0.05, 0.10\}$. The closed-form expression matches Monte Carlo simulations within ~1% inside the validity range $b \le \mathrm{bound} + 1$, correctly predicting SNR peaks at $b_{\mathrm{opt}} \in \{5.25, 1.68, 1.17\}$.
* **My read:** The analytic match is clean within the validity bound. Beyond $b > \mathrm{bound} + 1$, the Monte Carlo curves diverge upward due to low-cell saturation, precisely as the theory predicts.


2. **Device-Physics Crossbar Simulation (Fig. 3):** Evaluated on a 512×512 differential 4-bit crossbar array model incorporating non-additive IR-drop network solvers, ADC quantization, and programming noise across Gemma-3 270M and Llama-3.2 1B layers.
* **My read:** Despite non-additive physical effects, the predicted interior peak survives intact. SNR peaks at $b=5$, delivering a +1.6 dB gain over equal-fill ($b=1$) and a +3.3 to +3.4 dB improvement over standard base-16 bit-slicing. The broad, flat basin ($b \in [3, 8]$) confirms that integer rounding of $b_{\mathrm{opt}}$ incurs negligible loss.



3. **End-Application Benchmarks (Table I):** Evaluated on scientific MVM operators (2D Laplacian stencil, ill-conditioned matrix) and transformer zero-shot accuracy (8 LM-Eval harness tasks).
* **My read:** On Gemma-270M and Llama-1B, base-$N$ split at $b=6$ achieves +13.1% and +9.0% accuracy improvements over equal-fill ($b=1$). This matches the accuracy of residual redundancy (+12.3% and +7.7%) within run-to-run noise ($\pm 0.008$), while operating strictly on uniform cell placements without per-tile codebook overhead.



**Paper's conclusion vs. My read:** The authors conclude that optimal weight splitting under additive noise is governed by a simple, closed-form resolution-noise tradeoff that supersedes the prior $b=1$ convention. My read is that the experimental evidence strongly supports this claim for additive-limited crossbars. However, practical hardware often exhibits a hybrid mix of additive and state-dependent multiplicative noise, meaning deployed systems will operate on a spectrum between $b_{\mathrm{opt}}$ and $1$.

## In Case You Missed It (Confidence: 85%)

* `[pos]` Shared orthogonal preconditioning homogenizes weight distributions across tiles, concentrating 92–97% of optimal per-tile bases within $b \in \{4, 5, 6\}$ and removing the need for fine-grained per-tile base tuning.
* `[neu]` Signed 4-bit cells ($\mathrm{bound}=7$) with two cells per weight ($n_W=2$) establish an unsaturated validity ceiling of $b \le 8$.
* `[neg]` The closed-form derivation assumes purely additive tile output noise; conductance-proportional noise, state retention drift, and non-linear conductance tuning errors are omitted from the primary formula.
* `[neu]` Increasing the cell budget to $n_W \ge 3$ causes the quantization floor to collapse rapidly ($S = (b^{n_W}-1)/(b-1)$), shifting the theoretical optimum toward lower integer bases ($b_{\mathrm{opt}} \to 2$).

## Cautious Judgement (Confidence: 90%)

| Question | Answer | Confidence |
| --- | --- | --- |
| Fair comparison to external baselines? | Yes; compared against equal-fill ($b=1$), base-16 nibble slicing, rotated non-uniform grids, and residual redundancy at an identical 2-cell budget. | 90% |
| Invents its own FoM? | No; relies on standard relative MVM MSE, SNR in dB, and standard LM-Evaluation-Harness zero-shot accuracy metrics. | 95% |
| Rewrite of an existing idea? | No; unifies the slicing noise expression from Le Gallo et al. [1] with finite-grid quantization to derive a novel interior optimal base in closed form. | 90% |
| Reliable enough to reuse? | Yes; closed-form predictions are analytically verified and verified against a comprehensive device-physics crossbar simulator. | 90% |

## Sources and Limits (Confidence: 92%)

* **What was read:** The full text and figures of arXiv:2610.20359v1 [cs.ET] (arXiv HTML format).
* **What was not read/checked:** No supplementary code repository was inspected. Mathematical proofs and algebraic steps were not re-derived line-by-line per standard second-pass reading scope. External references ([1], [2]) were not separately fetched.

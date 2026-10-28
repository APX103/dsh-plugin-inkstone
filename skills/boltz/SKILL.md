---
name: boltz
description: Predict protein, nucleic-acid, or ligand complexes with Boltz-2, including GPU/Torch setup, weights, cache, and real CIF/PDB validation. Use for complex co-folding or Boltz readiness; 适用于蛋白质、核酸或配体复合物预测及 GPU 环境验证。
---

Predict protein, nucleic-acid, and small-molecule complexes with Boltz-2. The compute substrate is whatever the current turn actually has: run through `bash` on a host with a compatible NVIDIA GPU/CUDA stack, or delegate to a remote agent that provides the compute (say so in the reply). This adaptation follows the Claude Science Boltz workflow. It requires populated Boltz weights.

Environment readiness requirements:

- Reuse an isolated environment when one exists; otherwise prepare one. Preserve the upstream package order: CUDA-enabled torch first, then the pinned Boltz version, the compiled-kernel loader path, the `BOLTZ_CACHE` binding, and the required weight files. Consult the Boltz installation references or ask the user about missing settings rather than inventing them.
- Require `boltz` and `torch` imports, the `boltz` CLI, torch CUDA tensor execution, cache completeness, and a real prediction. Import success or `torch.cuda.is_available()` alone is insufficient.

Environment readiness witness — before any user task:

1. Write a fresh version-1 YAML with one protein chain `NLYIQWLKDGGPSSGRPPPS` and `msa: empty`.
2. Run `boltz predict` with one recycling step and one diffusion sample into a fresh output directory, using the declared `BOLTZ_CACHE`.
3. Require exit code 0 and at least one non-empty CIF or PDB below the output directory.
4. Record reusable host facts in a notes file inside the workspace; notes never certify readiness — only the witness does.

Do not add `--use_msa_server` during environment validation; it sends sequence data to a public service. During real work, use the MSA server only with the user's explicit decision, and say so in the reply. Long predictions belong in the background: submit them as a delegated long-running task instead of a foreground command.

Report: witness result (exit code, CIF/PDB paths and sizes), the exact commands and env vars used, confidence outputs the run actually produced, and every unresolved assumption about weights, GPU, or disclosure. Never claim predictions were produced that the tools did not actually produce.

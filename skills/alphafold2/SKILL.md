---
name: alphafold2
description: Predict protein structures with AlphaFold2 through ColabFold, including GPU/JAX setup, weights, disclosure boundaries, and real PDB validation. Use for monomer or multimer folding and AlphaFold2 readiness; 适用于蛋白质单体或多聚体结构预测及 GPU 环境验证。
---

Predict protein structures with AlphaFold2 through the ColabFold `colabfold_batch` runner, for monomer or multimer folding. The compute substrate is whatever the current turn actually has: run through `bash` on a host with a compatible NVIDIA GPU/CUDA stack, or delegate to a remote agent that provides the compute (say so in the reply). This adaptation follows the Claude Science AlphaFold2 workflow. It requires AlphaFold parameter license acceptance; never download or point at parameters the host has not legally obtained.

Environment readiness requirements:

- Reuse a compatible environment when one exists; otherwise prepare an isolated one. Follow the ColabFold installation references for dependency versions and ordered phases; do not invent missing version pins or cache settings.
- Require `colabfold_batch` on PATH, ColabFold/JAX imports, a JAX GPU device, compatible CUDA kernels, and a populated parameter directory containing `download_finished.txt` and `download_complexes_multimer_v3_finished.txt`.
- Set the declared data/cache path and the exact unified-memory/XLA environment variables in every invocation. Never infer a weight path, download acceptance, public MSA data disclosure, or credential.

Environment readiness witness — before any user task:

1. Write a fresh FASTA containing Trp-cage: `NLYIQWLKDGGPSSGRPPPS`.
2. Run `colabfold_batch` in single-sequence mode with one model and one recycle against the declared local parameter directory.
3. Require exit code 0 and at least one non-empty PDB in the fresh output directory.
4. Record reusable host facts (interpreter paths, env vars, cache locations) in a notes file inside the workspace; notes never certify readiness — only the witness does.

The public MMseqs2 MSA service can receive user sequences during real work, but never during environment validation, and never disclose sequence data without the user's explicit decision. Long folds belong in the background: submit them as a delegated long-running task instead of a foreground command, and say which you chose.

Report: witness result (exit code, PDB paths, sizes), the exact commands and env vars used, and every unresolved assumption about weights, GPU, or disclosure. Never claim structures were produced that the tools did not actually produce.

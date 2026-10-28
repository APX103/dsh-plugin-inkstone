---
name: proteinmpnn
description: Design amino-acid sequences for a protein backbone with ProteinMPNN, including CPU-capable setup and real FASTA validation. Use for inverse folding, backbone redesign, or ProteinMPNN readiness; 适用于蛋白质逆折叠、骨架重设计、CPU 环境配置和真实任务验证。
---

Inverse-fold a protein backbone into amino-acid sequences with ProteinMPNN. The compute substrate is whatever the current turn actually has: run through `bash` locally (CPU is supported for a small number of sequences; a GPU is optional for batches), or delegate to a remote agent that provides the compute (say so in the reply). This adaptation follows the Claude Science ProteinMPNN workflow. Code and bundled model weights come from https://github.com/dauparas/ProteinMPNN under its MIT license.

Environment recipe:

- Isolated Python environment with torch and numpy; BioPython only when the selected workflow requires it.
- Clone https://github.com/dauparas/ProteinMPNN.git and verify revision `8907e6671bfbfc92303b5f79c4b5e6ce47cdef57` before use. Do not run from another revision without telling the user and updating the recipe.
- The repository must contain `protein_mpnn_run.py`, `protein_mpnn_utils.py`, `vanilla_model_weights/v_48_020.pt`, and `inputs/PDB_monomers/pdbs/3HTN.pdb`.
- Run from the repository root because imports are relative.

Environment readiness witness — before any user task:

1. Import torch and numpy in the exact selected environment.
2. From the exact verified repository, run:
   `python protein_mpnn_run.py --pdb_path inputs/PDB_monomers/pdbs/3HTN.pdb --out_folder <fresh-witness-output> --num_seq_per_target 1 --sampling_temp 0.1 --seed 37 --batch_size 1`
3. Require exit code 0 and at least one non-empty `.fa` file below the fresh witness output directory.
4. Record reusable host facts in a notes file inside the workspace; notes never certify readiness — only the witness does.

For ordinary user work, `--sampling_temp` is a space-separated string and `--pdb_path_chains` is a space-separated chain list. Designs are written below `out/seqs`. Long batches belong in the background: submit them as a delegated long-running task instead of a foreground command.

Report: witness result (exit code, FASTA paths), the exact commands used, the verified repository revision, and every unresolved assumption. Validate delivered FASTA files are real, non-empty, and chemically plausible before presenting them; never claim sequences were produced that the tools did not actually produce.

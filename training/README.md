# Training the Monolith assistant

Goal: a small model (LFM2.5-VL-450M) that answers from your workspace and files, and writes the app's action
lines (`@event`, `@move`, `@cancel`, `@task`, `@done`, `@doc`) correctly **without** the 230-token ACT_GUIDE in the
prompt, so every turn is faster and cheaper.

| File | What it is |
| --- | --- |
| `monolith_agent.py` | The app's prompt format and a checker that parses replies like `splitActs` |
| `generate_data.py` | Synthetic training/test data in that exact format (held-out phrasings and titles) |
| `evaluate.py` | Scores any model/adapter on the test split; run it on the base model first |
| `monolith_agent_finetune.ipynb` | Colab notebook: generate → baseline → LoRA train → evaluate → export |
| `tests/` | `python -m pytest tests` guards the format against the app |

Quick start: open the notebook in Colab (Runtime → T4 GPU) and run top to bottom. About 6,000 examples and 2 epochs
fit in roughly an hour on a T4.

Before shipping a trained model: check the LFM Open License v1.0 terms for your use, add the model to
`src/ai/llm.ts` with `tuned: true` (that turns the long guide off), and run `evaluate.py` on the exported file's
source weights, not only the training adapter.
